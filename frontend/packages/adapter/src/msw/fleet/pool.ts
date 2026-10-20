// Тег Fleet: межфирменный ресурсный пул водителей (S2-14; api.js requestDriver, decideRequest). Контракт
// 0.5.0-stage2 (W2.00) — каталог, запрос, решение; 0.6.0-stage2 (W2.51) — публикация водителя фирмой-источником,
// временное назначение со сроком (AUTH-07), автозавершение и 404 временному водителю после срока (AC-06, D09).
// Пул показывает минимум сведений (AUTH-06); запрос не даёт доступа до одобрения фирмой-источником. Демо-ответ
// «Одобрить» / «Отклонить» эталона не переносится (PD-54): решает менеджер фирмы-источника или владелец.
import type { components } from '@ortus/api-client';

import { isDriver } from '../core/access.ts';
import { page, uuidParam } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import {
  checkFit,
  OFFER_TEXT,
  offerVehicles,
  settleOffers,
  syncTransferVehicle,
  vehicleRef,
} from './offers.ts';
import {
  NOT_STARTED,
  overlaps,
  publicationFor,
  revokeTransfer,
  settlePool,
  settleTransfer,
  within,
} from './pool-rules.ts';
import {
  accountsWith,
  compatOf,
  covers,
  type FleetData,
  fleetOf,
  notify,
  type PoolPublicationRow,
  type TripRow,
  tripVisible,
  unitsFor,
  type VehicleRow,
} from './state.ts';

type S = components['schemas'];

/** Ключи DriverTransfer в порядке схемы (ответы — как примеры tools/gen/examples-w251/w271.mjs). */
const TRANSFER_KEYS: readonly (keyof S['DriverTransfer'])[] = [
  'id',
  'driverMemberId',
  'sourceOrgUnitId',
  'targetOrgUnitId',
  'window',
  'status',
  'revision',
  'tripId',
  'publicationId',
  'driverDisplayName',
  'sourceOrgUnitName',
  'targetOrgUnitName',
  'tripNumber',
  'reason',
  'requestedByMemberId',
  'requestedAt',
  'decidedByMemberId',
  'decidedAt',
  'revokedByMemberId',
  'decisionComment',
  'grant',
  'completedAt',
  'vehicle',
];

/** DriverTransfer — копия в порядке схемы. */
const transferDto = (x: S['DriverTransfer']): S['DriverTransfer'] =>
  Object.fromEntries(
    TRANSFER_KEYS.filter((k) => x[k] !== undefined).map((k) => [k, structuredClone(x[k])]),
  ) as S['DriverTransfer'];

/** W2.71: обычная машина запрошена (режим home или host_or_home). */
const usualRequested = (x: S['DriverTransfer']): boolean =>
  x.vehicle?.mode === 'home' || x.vehicle?.mode === 'host_or_home';

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const DIRECTIONS = ['incoming', 'outgoing'] as const;
const STATUSES: readonly S['DriverTransfer']['status'][] = [
  'requested',
  'approved',
  'rejected',
  'expired',
  'revoked',
  'completed',
];
const PUBLICATION_STATES: readonly S['DriverPoolPublication']['state'][] = [
  'active',
  'withdrawn',
  'expired',
];
/** Состояния рейса, в которых водитель занят (публикация на это время — 409). */
const DONE: ReadonlySet<S['TripState']> = new Set(['accepted', 'cancelled']);

function instant(ctx: HandlerContext, name: string): string {
  const v = ctx.query.get(name);
  if (v === null || !INSTANT.test(v)) fail('malformed_request', `Нужен параметр ${name}.`);
  return v;
}

/** Пул организации с досчитанным временем (истечения, автозавершение, срок выбора машины W2.71). */
function poolOf(ctx: HandlerContext) {
  const f = fleetOf(ctx.org().org);
  settlePool(f, ctx.now());
  settleOffers(ctx);
  for (const x of f.transfers) syncTransferVehicle(f, x);
  return f;
}

const unitName = (ctx: HandlerContext, id: string): string =>
  ctx.org().org.units.find((u) => u.id === id)?.name ?? '';

/** Запрос виден логисту фирмы-источника или получателя (и владельцу). */
function transferVisible(ctx: HandlerContext, x: S['DriverTransfer']): boolean {
  const units = unitsFor(ctx.org(), 'fleet.driver_transfers.read', ctx.now());
  return covers(units, x.sourceOrgUnitId) || covers(units, x.targetOrgUnitId);
}

function transferOr404(ctx: HandlerContext): S['DriverTransfer'] {
  const x = poolOf(ctx).transfers.find((r) => r.id === ctx.params.requestId?.toLowerCase());
  if (!x || !transferVisible(ctx, x)) fail('not_found', 'Запрос не найден.');
  return x;
}

/** Публикация видна фирме-источнику (fleet.driver_transfers.read на домашнюю фирму) и владельцу. */
const publicationVisible = (ctx: HandlerContext, p: PoolPublicationRow): boolean =>
  covers(unitsFor(ctx.org(), 'fleet.driver_transfers.read', ctx.now()), p.homeOrgUnitId);

function publicationOr404(ctx: HandlerContext): PoolPublicationRow {
  const p = poolOf(ctx).pool.find((r) => r.id === ctx.params.publicationId?.toLowerCase());
  if (!p || !publicationVisible(ctx, p)) fail('not_found', 'Публикация не найдена.');
  return p;
}

/** DriverPoolPublication — поля в порядке схемы (так же — tools/gen/examples-w251.mjs). */
function publicationDto(ctx: HandlerContext, p: PoolPublicationRow): S['DriverPoolPublication'] {
  return {
    id: p.id,
    driverMemberId: p.driverMemberId,
    ...(p.driverDisplayName ? { driverDisplayName: p.driverDisplayName } : {}),
    displayName: p.displayName,
    homeOrgUnitId: p.homeOrgUnitId,
    homeOrgUnitName: unitName(ctx, p.homeOrgUnitId),
    qualifications: [...p.qualifications],
    freeWindow: { ...p.freeWindow },
    ...(p.terms !== undefined ? { terms: p.terms } : {}),
    state: p.state,
    ...(p.publishedByMemberId ? { publishedByMemberId: p.publishedByMemberId } : {}),
    publishedAt: p.publishedAt,
    ...(p.withdrawnAt ? { withdrawnAt: p.withdrawnAt } : {}),
    ...(p.withdrawnByMemberId ? { withdrawnByMemberId: p.withdrawnByMemberId } : {}),
    ...(p.withdrawalComment ? { withdrawalComment: p.withdrawalComment } : {}),
    ...(p.usualVehicleId ? { usualVehicleId: p.usualVehicleId } : {}),
    revision: p.revision,
  };
}

/** Строка проверки совместимости — текст причины (как reasons домена). */
const reasonOf = (x: { label: string; value: string; need?: string }): string =>
  `${x.label}: ${x.value}${x.need ? ', нужно ' + x.need : ''}`;

/**
 * W2.71 (S2-20 правила 1–2, 1a): обычная машина водителя в каталоге — модель, номер, кузов, габариты; с рейсом —
 * совместимость с грузом и занятость на окно. Поля в порядке схемы PoolUsualVehicle.
 */
function usualVehicleDto(
  f: FleetData,
  p: PoolPublicationRow,
  trip: TripRow | undefined,
): S['PoolUsualVehicle'] | undefined {
  const v = p.usualVehicleId ? f.vehicles.find((x) => x.id === p.usualVehicleId) : undefined;
  if (!v) return undefined;
  const c = trip ? compatOf(v, trip) : undefined;
  return {
    vehicleId: v.id,
    displayName: v.displayName,
    registrationNumber: v.registrationNumber,
    bodyType: v.bodyType,
    capacity: { ...v.capacity },
    ...(v.temperatureMinC !== undefined ? { temperatureMinC: v.temperatureMinC } : {}),
    ...(v.temperatureMaxC !== undefined ? { temperatureMaxC: v.temperatureMaxC } : {}),
    ...(c
      ? {
          fit: {
            ok: c.fit,
            reasons: c.checks
              .slice(1)
              .filter((x) => !x.ok)
              .map(reasonOf),
          },
          freeForWindow: c.checks[0]?.ok ?? false,
        }
      : {}),
  };
}

/** Машина фирмы `unit`, видимая актору (fleet.vehicles.read), или 404 «Машина не найдена.». */
function unitVehicleOr404(ctx: HandlerContext, id: string, unit: string): VehicleRow {
  const v = fleetOf(ctx.org().org).vehicles.find((x) => x.id === id.toLowerCase());
  const seen = !!v && covers(unitsFor(ctx.org(), 'fleet.vehicles.read', ctx.now()), v.orgUnitId);
  if (!v || !seen || v.orgUnitId !== unit) fail('not_found', 'Машина не найдена.');
  return v;
}

/** 422 поля запроса или решения (одно нарушение). */
function invalid(detail: string, field: string, code: string, message: string): never {
  return fail('validation_failed', detail, { violations: [{ field, code, message }] });
}

/**
 * W2.71 (S2-20, 1a): машина в запросе водителя — режим, машина фирмы рейса, обычная машина публикации; каждая
 * проверяется по грузу и окну рейса (409 vehicle_incompatible / reservation_overlap). Броней до одобрения нет.
 */
function requestedVehicle(
  ctx: HandlerContext,
  f: FleetData,
  v: S['DriverTransferVehicleCreate'],
  pub: PoolPublicationRow,
  trip: TripRow | undefined,
  target: string,
): S['DriverTransferVehicle'] {
  if (!trip) invalid('Проверьте рейс.', 'tripId', 'required', OFFER_TEXT.tripRequired);
  const withHost = v.mode !== 'home';
  const withUsual = v.mode !== 'host';
  if (withHost && !v.hostVehicleId) {
    invalid('Проверьте машину.', 'vehicle.hostVehicleId', 'required', OFFER_TEXT.hostRequired);
  }
  if (!withHost && v.hostVehicleId) {
    invalid('Проверьте машину.', 'vehicle.hostVehicleId', 'home', OFFER_TEXT.hostNotWithHome);
  }
  const usual = withUsual
    ? f.vehicles.find((x) => x.id === pub.usualVehicleId && x.orgUnitId === pub.homeOrgUnitId)
    : undefined;
  if (withUsual && !usual) {
    invalid('Проверьте машину.', 'vehicle.mode', 'usual_vehicle', OFFER_TEXT.noUsualVehicle);
  }
  const host = withHost ? unitVehicleOr404(ctx, v.hostVehicleId ?? '', target) : undefined;
  if (host) checkFit(host, trip, 'vehicle.hostVehicleId');
  if (usual) checkFit(usual, trip, 'vehicle.mode');
  const org = ctx.org().org;
  return {
    mode: v.mode,
    ...(host ? { hostVehicle: vehicleRef(org, host) } : {}),
    ...(usual ? { homeVehicle: vehicleRef(org, usual) } : {}),
  };
}

/** Не тот сотрудник для публикации — один ответ для неизвестного, чужого, неактивного и не водителя. */
function notPublishable(): never {
  return fail('validation_failed', 'Проверьте водителя.', {
    violations: [
      {
        field: 'driverMemberId',
        code: 'driver',
        message: 'Нужен действующий сотрудник фирмы с функцией «Водитель»',
      },
    ],
  });
}

/** DriverAvailability каталога: только минимум, разрешённый владеющей фирмой (AUTH-06). */
function availability(
  ctx: HandlerContext,
  p: PoolPublicationRow,
  trip?: TripRow,
): S['DriverAvailability'] {
  const usual = usualVehicleDto(fleetOf(ctx.org().org), p, trip);
  return {
    driverMemberId: p.driverMemberId,
    displayName: p.displayName,
    homeOrgUnitId: p.homeOrgUnitId,
    qualifications: [...p.qualifications],
    freeWindow: { ...p.freeWindow },
    ...(p.terms !== undefined ? { terms: p.terms } : {}),
    publicationId: p.id,
    homeOrgUnitName: unitName(ctx, p.homeOrgUnitId),
    ...(usual ? { usualVehicle: usual } : {}),
  };
}

const memberId = (ctx: HandlerContext): string | undefined => ctx.org().member?.id;

function validWindow(w: S['TimeWindow'], field: string): void {
  if (w.startsAt >= w.endsAt) {
    fail('validation_failed', 'Проверьте срок.', {
      violations: [{ field, code: 'range', message: 'Окончание должно быть позже начала' }],
    });
  }
}

/** Следующий псевдоним пула: «Водитель #N» после всех номеров организации. */
function nextLabel(pool: readonly PoolPublicationRow[]): string {
  const n = Math.max(0, ...pool.map((p) => Number(/#(\d+)$/.exec(p.displayName)?.[1] ?? 0)));
  return `Водитель #${n + 1}`;
}

/** Перепроверка при одобрении: рейс мог получить водителя, начаться или закрыться; водитель может быть уже занят. */
function approvable(f: FleetData, x: S['DriverTransfer'], trip: TripRow | undefined): void {
  if (trip?.driverMemberId && trip.driverMemberId !== x.driverMemberId) {
    fail('invalid_transition', 'У рейса уже есть водитель.');
  }
  if (trip && !NOT_STARTED.has(trip.state)) {
    fail('invalid_transition', 'Рейс уже начат или закрыт.');
  }
  if (busy(f, x, x.window)) fail('resources_unavailable', 'Водитель уже назначен в это время.');
}

/** Другой одобренный перевод того же водителя пересекает окно `w`. */
const busy = (f: FleetData, x: S['DriverTransfer'], w: S['TimeWindow']): boolean =>
  f.transfers.some(
    (o) =>
      o.id !== x.id &&
      o.driverMemberId === x.driverMemberId &&
      o.status === 'approved' &&
      overlaps(o.window, w),
  );

/**
 * Продление (W2.57, решение extend): новый конец позже нынешнего («Проверьте срок.») и сейчас («Окно уже прошло.»),
 * внутри свободного окна публикации (422 window), водитель свободен в новом окне (409); назначение следует за окном —
 * закрывающее снова active.
 */
function extendTransfer(f: FleetData, x: S['DriverTransfer'], until: string, now: string): void {
  const range = (text: string) =>
    fail('validation_failed', text, {
      violations: [
        {
          field: 'endsAt',
          code: 'range',
          message: 'Конец окна — позже нынешнего и позже текущего момента',
        },
      ],
    });
  if (until <= x.window.endsAt) range('Проверьте срок.');
  if (until <= now) range('Окно уже прошло.');
  const w = { ...x.window, endsAt: until };
  const pub = f.pool.find((p) => p.id === x.publicationId);
  if (!pub || !within(w, pub.freeWindow)) {
    fail('validation_failed', 'Срок вне свободного окна водителя.', {
      violations: [
        { field: 'window', code: 'outside_free_window', message: 'Вне свободного окна водителя' },
      ],
    });
  }
  if (busy(f, x, w)) fail('resources_unavailable', 'Водитель уже назначен в это время.');
  x.window.endsAt = until;
  if (x.grant) x.grant.validUntil = until;
  x.revision++;
  settleTransfer(f, x, now);
}

export const poolHandlers: Registry = {
  listAvailableDrivers: (ctx) => {
    const from = instant(ctx, 'availableFrom');
    const until = instant(ctx, 'availableUntil');
    const t = ctx.org();
    const f = poolOf(ctx);
    const want = { startsAt: from, endsAt: until, timeZone: 'UTC' };
    const busy = (id: string) =>
      f.transfers.some(
        (x) => x.driverMemberId === id && x.status === 'approved' && overlaps(x.window, want),
      );
    // «Свободные водители других фирм группы»: своих логист в каталоге не видит (владелец — всех).
    const own = t.owner
      ? new Set<string>()
      : unitsFor(t, 'fleet.driver_transfers.request', ctx.now());
    // W2.71 (S2-20 правило 2): рейс, для которого логист смотрит обычные машины водителей.
    const tripId = uuidParam(ctx.query, 'tripId', false);
    const trip = tripId ? f.trips.find((x) => x.id === tripId) : undefined;
    if (tripId && (!trip || !tripVisible(ctx, trip))) fail('not_found', 'Рейс не найден.');
    const items = f.pool
      .filter(
        (p) =>
          p.state === 'active' &&
          overlaps(p.freeWindow, want) &&
          !busy(p.driverMemberId) &&
          !(own !== 'all' && own.has(p.homeOrgUnitId)),
      )
      .map((p) => availability(ctx, p, trip));
    return { body: page(items, ctx.query) };
  },

  listDriverTransfers: (ctx) => {
    const t = ctx.org();
    const direction = ctx.query.get('direction');
    if (direction !== null && !(DIRECTIONS as readonly string[]).includes(direction)) {
      fail('malformed_request', 'Параметр direction — incoming или outgoing.');
    }
    const statuses = ctx.query.getAll('status');
    if (statuses.some((s) => !(STATUSES as readonly string[]).includes(s))) {
      fail('malformed_request', 'Неизвестный статус запроса.');
    }
    const approve = unitsFor(t, 'fleet.driver_transfers.approve', ctx.now());
    const request = unitsFor(t, 'fleet.driver_transfers.request', ctx.now());
    const items = poolOf(ctx).transfers.filter(
      (x) =>
        transferVisible(ctx, x) &&
        (!statuses.length || statuses.includes(x.status)) &&
        (direction !== 'incoming' || covers(approve, x.sourceOrgUnitId)) &&
        (direction !== 'outgoing' || covers(request, x.targetOrgUnitId)),
    );
    return { body: page(items.map(transferDto), ctx.query) };
  },

  getDriverTransfer: (ctx) => ({ body: transferDto(transferOr404(ctx)) }),

  requestDriverTransfer: (ctx) => {
    const t = ctx.org();
    const f = poolOf(ctx);
    const b = ctx.body as S['DriverTransferCreate'];
    const target = b.targetOrgUnitId.toLowerCase();
    const source = b.sourceOrgUnitId.toLowerCase();
    if (!covers(unitsFor(t, 'fleet.driver_transfers.request', ctx.now()), target)) {
      fail('forbidden_action');
    }
    const pub = publicationFor(f, b.driverMemberId.toLowerCase(), b.window, b.publicationId);
    if (!pub) fail('not_found', 'Водитель не опубликован в пуле.');
    if (pub.homeOrgUnitId !== source || source === target) {
      fail('validation_failed', 'Фирма-источник — домашняя фирма водителя.', {
        violations: [
          { field: 'sourceOrgUnitId', code: 'source', message: 'Другая фирма водителя' },
        ],
      });
    }
    validWindow(b.window, 'window');
    // Временное назначение не выходит за свободное окно, опубликованное фирмой-источником (AUTH-07).
    if (!within(b.window, pub.freeWindow)) {
      fail('validation_failed', 'Срок вне свободного окна водителя.', {
        violations: [
          { field: 'window', code: 'outside_free_window', message: 'Вне свободного окна водителя' },
        ],
      });
    }
    const trip = b.tripId ? f.trips.find((x) => x.id === b.tripId?.toLowerCase()) : undefined;
    if (b.tripId && (!trip || !tripVisible(ctx, trip))) fail('not_found', 'Рейс не найден.');
    // Водитель нужен на рейс своей фирмы (эталон api.js:542 assertCan('logistics', 'edit', t.unit)).
    if (trip && trip.orgUnitId !== target) {
      fail('validation_failed', 'Рейс другой фирмы.', {
        violations: [{ field: 'tripId', code: 'org_unit', message: 'Рейс другой фирмы' }],
      });
    }
    if (trip?.driverMemberId) fail('invalid_transition', 'У рейса уже есть водитель.');
    // Один открытый запрос на опубликованного водителя (api.js:544).
    if (f.transfers.some((x) => x.publicationId === pub.id && x.status === 'requested')) {
      fail('invalid_transition', 'Запрос уже отправлен');
    }
    const vehicle = b.vehicle ? requestedVehicle(ctx, f, b.vehicle, pub, trip, target) : undefined;
    const by = memberId(ctx);
    const row: S['DriverTransfer'] = {
      id: ctx.newId(),
      driverMemberId: pub.driverMemberId,
      sourceOrgUnitId: source,
      targetOrgUnitId: target,
      window: { ...b.window },
      status: 'requested',
      revision: 1,
      ...(trip ? { tripId: trip.id } : {}),
      publicationId: pub.id,
      driverDisplayName: pub.displayName,
      sourceOrgUnitName: unitName(ctx, source),
      targetOrgUnitName: unitName(ctx, target),
      ...(trip ? { tripNumber: trip.number } : {}),
      reason: b.reason,
      ...(by ? { requestedByMemberId: by } : {}),
      requestedAt: ctx.now(),
      ...(vehicle ? { vehicle } : {}),
    };
    f.transfers.push(row);
    return { status: 201, body: transferDto(row) };
  },

  decideDriverTransfer: (ctx) => {
    const t = ctx.org();
    const f = fleetOf(t.org);
    const b = ctx.body as S['DriverTransferDecision'];
    // W2.57: endsAt — только у продления и обязателен у него; форма тела — до остальных проверок.
    if ((b.endsAt !== undefined) !== (b.decision === 'extend')) {
      fail('validation_failed', 'Проверьте срок.', {
        violations: [
          { field: 'endsAt', code: 'extend', message: 'Новый конец окна — только у продления' },
        ],
      });
    }
    // W2.71 (S2-20, 1b; Q-W2.70-8): «Отклонить» — только с причиной, до остальных проверок.
    if (b.decision === 'reject' && !b.comment?.trim()) {
      invalid(`${OFFER_TEXT.rejectReason}.`, 'comment', 'required', OFFER_TEXT.rejectReason);
    }
    const x = transferOr404(ctx);
    if (!covers(unitsFor(t, 'fleet.driver_transfers.approve', ctx.now()), x.sourceOrgUnitId)) {
      fail('forbidden_action');
    }
    ctx.revision(x.revision);
    const onApproved = b.decision === 'revoke' || b.decision === 'extend';
    if (onApproved ? x.status !== 'approved' : x.status !== 'requested') {
      fail('invalid_transition', 'Запрос уже рассмотрен.');
    }
    const approving = b.decision === 'approve' || b.decision === 'approve_driver_only';
    if (b.decision === 'approve_driver_only' && !usualRequested(x)) {
      invalid('Проверьте решение.', 'decision', 'usual_vehicle', OFFER_TEXT.driverOnly);
    }
    const trip = x.tripId ? f.trips.find((r) => r.id === x.tripId) : undefined;
    const now = ctx.now();
    const by = memberId(ctx);
    if (b.decision === 'extend') {
      extendTransfer(f, x, b.endsAt ?? '', now);
      return { body: transferDto(x) };
    }
    // W2.71: машины запроса перепроверяются целиком до записи (Q-W2.70-11): 409 — одобрение не проходит.
    const vehicleOf = (ref: S['TransferVehicle'] | undefined) =>
      ref ? f.vehicles.find((v) => v.id === ref.vehicleId) : undefined;
    const host = approving ? vehicleOf(x.vehicle?.hostVehicle) : undefined;
    const usual = b.decision === 'approve' ? vehicleOf(x.vehicle?.homeVehicle) : undefined;
    if (approving) {
      approvable(f, x, trip);
      if (trip && host) checkFit(host, trip, 'vehicle.hostVehicleId');
      if (trip && usual) checkFit(usual, trip, 'vehicle.mode');
    }
    if (b.decision === 'revoke') {
      revokeTransfer(f, x, now, by);
    } else {
      x.status = approving ? 'approved' : 'rejected';
      if (by) Object.assign(x, { decidedByMemberId: by }); // readOnly в схеме: пишет только сервер
      x.decidedAt = now;
      if (b.comment) x.decisionComment = b.comment;
    }
    if (x.status === 'approved') {
      x.grant = {
        assignmentId: ctx.newId(),
        orgUnitId: x.targetOrgUnitId,
        ...(x.tripId ? { tripId: x.tripId } : {}),
        validFrom: x.window.startsAt,
        validUntil: x.window.endsAt,
        state: 'scheduled',
      };
      if (trip) {
        trip.driverMemberId = x.driverMemberId;
        trip.driverDisplayName = `${x.driverDisplayName ?? 'Водитель'} · временно`;
        trip.revision++;
      }
      // W2.71 (S2-20): брони предложения одной транзакцией с назначением (docs/29 «Решение» п. 1).
      if (x.vehicle && trip && b.decision !== 'revoke') {
        if (usualRequested(x)) x.vehicle.homeDecision = usual ? 'approved' : 'declined';
        if (host || usual) {
          const offer = offerVehicles(ctx, f, trip, x.driverMemberId, host, usual);
          x.vehicle.offerGroupId = offer.group;
          if (offer.chooseUntil) x.vehicle.chooseUntil = offer.chooseUntil;
          syncTransferVehicle(f, x);
        }
      }
      settleTransfer(f, x, now);
    }
    x.revision++;
    if (b.decision !== 'revoke') {
      const verb = x.status === 'approved' ? 'одобрен' : 'отклонён';
      notify(ctx, accountsWith(ctx, 'fleet.driver_transfers.request', x.targetOrgUnitId), {
        kind: 'fleet.driver_transfer.decided',
        severity: 'info',
        title: `Запрос водителя ${x.driverDisplayName ?? ''} ${verb} фирмой ${x.sourceOrgUnitName ?? ''}`,
        ...(x.tripId ? { tripId: x.tripId } : {}),
      });
    }
    return { body: transferDto(x) };
  },
  // W2.51: публикация фирмой-источником.
  listDriverPoolPublications: (ctx) => {
    const state = ctx.query.get('state');
    if (state !== null && !(PUBLICATION_STATES as readonly string[]).includes(state)) {
      fail('malformed_request', 'Параметр state — active, withdrawn или expired.');
    }
    const home = uuidParam(ctx.query, 'homeOrgUnitId', false);
    const items = poolOf(ctx)
      .pool.filter(
        (p) =>
          publicationVisible(ctx, p) &&
          (state === null || p.state === state) &&
          (!home || p.homeOrgUnitId === home),
      )
      .sort(
        (a, b) =>
          b.freeWindow.startsAt.localeCompare(a.freeWindow.startsAt) || a.id.localeCompare(b.id),
      )
      .map((p) => publicationDto(ctx, p));
    return { body: page(items, ctx.query) };
  },

  getDriverPoolPublication: (ctx) => ({ body: publicationDto(ctx, publicationOr404(ctx)) }),

  publishDriverToPool: (ctx) => {
    const t = ctx.org();
    const f = poolOf(ctx);
    const b = ctx.body as S['DriverPoolPublicationCreate'];
    const home = b.homeOrgUnitId.toLowerCase();
    // Возврат 2, порядок шлюза и createTripPlan (AC-01): права нет ни в одной фирме — 403; фирма, которую участник не
    // видит (org_units.read), отвечает как несуществующая — одинаковый 422; 403 — только видимой фирме без права.
    // Ответ не выдаёт, какие фирмы есть.
    const approve = unitsFor(t, 'fleet.driver_transfers.approve', ctx.now());
    if (approve !== 'all' && approve.size === 0) fail('forbidden_action');
    const seen = covers(unitsFor(t, 'org_units.read', ctx.now()), home) || covers(approve, home);
    if (!seen || !t.org.units.some((u) => u.id === home)) {
      fail('validation_failed', 'Подразделение не найдено.', {
        violations: [{ field: 'homeOrgUnitId', code: 'unknown', message: 'Нет такой фирмы' }],
      });
    }
    if (!covers(approve, home)) fail('forbidden_action');
    // Неизвестный и не свой сотрудник отвечают одинаково: ответ не выдаёт состав других фирм группы.
    const m = t.org.members.find((x) => x.id === b.driverMemberId.toLowerCase());
    if (
      !m ||
      m.status !== 'active' ||
      !m.orgUnitIds.includes(home) ||
      !isDriver(t.org, m, ctx.now())
    ) {
      return notPublishable();
    }
    // W2.71 (S2-20 правило 1, TD-01): обычная машина — машина домашней фирмы; неизвестная, невидимая и чужая —
    // одинаковый 422 (ответ не выдаёт машины других фирм).
    let usual: VehicleRow | undefined;
    if (b.usualVehicleId) {
      usual = f.vehicles.find((x) => x.id === b.usualVehicleId?.toLowerCase());
      const seen =
        !!usual && covers(unitsFor(t, 'fleet.vehicles.read', ctx.now()), usual.orgUnitId);
      if (!usual || !seen || usual.orgUnitId !== home) {
        invalid('Проверьте машину.', 'usualVehicleId', 'vehicle', OFFER_TEXT.usualVehicle);
      }
    }
    validWindow(b.freeWindow, 'freeWindow');
    if (b.freeWindow.endsAt <= ctx.now()) {
      fail('validation_failed', 'Окно уже прошло.', {
        violations: [{ field: 'freeWindow', code: 'past', message: 'Окно должно быть в будущем' }],
      });
    }
    // Как exclude tenant 0014 (where withdrawn_at is null): окно держат и истёкшие, не снятые публикации.
    if (
      f.pool.some(
        (p) =>
          p.driverMemberId === m.id &&
          p.state !== 'withdrawn' &&
          overlaps(p.freeWindow, b.freeWindow),
      )
    ) {
      fail('resources_unavailable', 'Водитель уже опубликован в пуле на это время.');
    }
    const trip = f.trips.find(
      (x) =>
        x.driverMemberId === m.id && !DONE.has(x.state) && overlaps(x.plannedWindow, b.freeWindow),
    );
    if (trip) fail('resources_unavailable', `Водитель занят в это время: рейс ${trip.number}.`);
    const by = memberId(ctx);
    const row: PoolPublicationRow = {
      id: ctx.newId(),
      proto: m.proto, // как сид (state.ts publicationOf): proto — id водителя прототипа
      driverMemberId: m.id,
      driverDisplayName: m.displayName,
      displayName: nextLabel(f.pool),
      homeOrgUnitId: home,
      qualifications: [...b.qualifications],
      freeWindow: { ...b.freeWindow },
      ...(b.terms !== undefined ? { terms: b.terms } : {}),
      state: 'active',
      ...(by ? { publishedByMemberId: by } : {}),
      publishedAt: ctx.now(),
      ...(usual ? { usualVehicleId: usual.id } : {}),
      revision: 1,
    };
    f.pool.push(row);
    return { status: 201, body: publicationDto(ctx, row) };
  },

  withdrawDriverPoolPublication: (ctx) => {
    const t = ctx.org();
    const f = poolOf(ctx);
    const p = publicationOr404(ctx);
    if (!covers(unitsFor(t, 'fleet.driver_transfers.approve', ctx.now()), p.homeOrgUnitId)) {
      fail('forbidden_action');
    }
    ctx.revision(p.revision);
    if (p.state !== 'active') fail('invalid_transition', 'Водитель уже снят из пула.');
    const b = ctx.body as S['DriverPoolWithdrawal'];
    const by = memberId(ctx);
    p.state = 'withdrawn';
    p.withdrawnAt = ctx.now();
    if (by) p.withdrawnByMemberId = by;
    if (b.comment) p.withdrawalComment = b.comment;
    p.revision++;
    for (const x of f.transfers) {
      if (x.publicationId === p.id && x.status === 'requested') {
        x.status = 'expired';
        x.revision++;
      }
    }
    return { body: publicationDto(ctx, p) };
  },
};
