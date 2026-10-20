// Тег Fleet, контракт 0.5.0-stage2 (W2.00): чек-листы по версии, осмотры выезда и сдачи с пятью готовыми фото
// (api.js submitDeparture, submitReturn), дефекты осмотра и очередь блокирующих дефектов менеджера с решением
// «разрешить выезд» / «подтвердить неисправность» (S2-17, D-29 комплекта; api.js decideDefect).
import type { components } from '@ortus/api-client';
import { int, plural } from '@ortus/domain';

import { page, uuidParam } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import type { Org } from '../core/state.ts';
import { duplicateOf, receivedAt } from '../files/duplicates.ts';
import { OFFER_TEXT, undecided } from './offers.ts';
import {
  accountOf,
  accountsWith,
  asDriver,
  covers,
  type DefectRow,
  defectDto,
  fleetOf,
  type InspectionRow,
  inspectionDto,
  notify,
  releaseHold,
  tripVisible,
  type TripRow,
  unitsFor,
  vehicleOr404,
} from './state.ts';

type S = components['schemas'];

const DEFECT_STATES = ['open', 'in_review', 'resolved', 'confirmed_out_of_service'];

const lower = (id: string | undefined): string => (id ?? '').toLowerCase();

/** Рейс осмотра: выезд — по брони водителя, сдача — по рейсу. */
function tripOfInspection(
  ctx: HandlerContext,
  b: S['InspectionCreate'],
  vehicleId: string,
): TripRow {
  const f = fleetOf(ctx.org().org);
  if (b.kind === 'departure') {
    if (!b.reservationId) {
      fail('validation_failed', 'Осмотр перед выездом оформляется по брони.', {
        violations: [{ field: 'reservationId', code: 'required', message: 'Нужна бронь' }],
      });
    }
    const r = f.reservations.find((x) => x.id === lower(b.reservationId));
    const trip = r?.tripId ? f.trips.find((x) => x.id === r.tripId) : undefined;
    if (
      !r ||
      r.vehicleId !== vehicleId ||
      !trip ||
      !tripVisible(ctx, trip, 'fleet.inspections.submit')
    ) {
      fail('not_found', 'Бронь не найдена.');
    }
    // W2.71 (S2-20): до выбора из предложенных осмотра нет; подтверждённая бронь (выбранная или единственная)
    // осматривается сразу — первый снимок закрепляет её (assigned → inspection, вариант (b) D-35 комплекта).
    if (undecided(f, r, ctx.now())) fail('invalid_transition', OFFER_TEXT.chooseFirst);
    const bound =
      r.state === 'confirmed' && trip.state === 'assigned' && trip.reservationId === r.id;
    if (
      (r.state !== 'held' && r.state !== 'confirmed') ||
      (trip.state !== 'inspection' && !bound)
    ) {
      fail('invalid_transition', 'Осмотр перед выездом уже отправлен или бронь снята.');
    }
    return trip;
  }
  if (!b.tripId) {
    fail('validation_failed', 'Осмотр при сдаче оформляется по рейсу.', {
      violations: [{ field: 'tripId', code: 'required', message: 'Нужен рейс' }],
    });
  }
  const trip = f.trips.find((x) => x.id === lower(b.tripId));
  if (!trip || !tripVisible(ctx, trip, 'fleet.inspections.submit'))
    fail('not_found', 'Рейс не найден.');
  if (trip.vehicleId !== vehicleId) {
    fail('validation_failed', 'Машина осмотра — не машина рейса.', {
      violations: [{ field: 'vehicleId', code: 'trip', message: 'Другая машина' }],
    });
  }
  if (trip.state !== 'returning' && trip.state !== 'rework') {
    fail('invalid_transition', 'Сначала «Завершить рейс».');
  }
  return trip;
}

/** Чего не хватает (inspMissing эталона): «N фото», «N пунктов чек-листа». */
function missingOf(b: S['InspectionCreate'], list: S['InspectionChecklist']): string[] {
  const out: string[] = [];
  const photos = list.requiredPhotoRoles.filter((r) => !b.photos.some((p) => p.role === r)).length;
  if (photos) out.push(`${photos} фото`);
  const checks = list.items.filter(
    (i) => i.required && !b.checks.some((c) => c.key === i.key),
  ).length;
  if (checks) out.push(`${checks} ${plural(checks, 'пункт', 'пункта', 'пунктов')} чек-листа`);
  return out;
}

/**
 * Фото осмотра с доказательствами (W2.52, антифрод фото): серверное время приёма (completeUpload) и повтор файла
 * по sha256 на момент отправки — закрепляются в осмотре; фото того же осмотра — «тот же владелец».
 */
function evidenceOf(org: Org, photos: S['InspectionPhoto'][]): S['InspectionPhoto'][] {
  const peers = new Set(photos.map((p) => lower(p.fileId)));
  return photos.map((p) => {
    const fileId = lower(p.fileId);
    const at = receivedAt(org, fileId);
    const warning = duplicateOf(org, fileId, peers);
    return {
      role: p.role,
      fileId,
      capturedAt: p.capturedAt,
      ...(at ? { serverCapturedAt: at } : {}),
      ...(warning ? { duplicateWarning: warning } : {}),
    };
  });
}

function inspectionVisible(ctx: HandlerContext, i: InspectionRow): boolean {
  const t = ctx.org();
  const f = fleetOf(t.org);
  const me = asDriver(t, ctx.now());
  if (me) return i.memberId === me.id;
  const v = f.vehicles.find((x) => x.id === i.vehicleId);
  return !!v && covers(unitsFor(t, 'fleet.inspections.read', ctx.now()), v.orgUnitId);
}

function defectVisible(ctx: HandlerContext, d: DefectRow, key: string): boolean {
  const t = ctx.org();
  const f = fleetOf(t.org);
  const me = asDriver(t, ctx.now());
  if (me) {
    const trip = d.tripId ? f.trips.find((x) => x.id === d.tripId) : undefined;
    return d.reportedByMemberId === me.id || trip?.driverMemberId === me.id;
  }
  const v = f.vehicles.find((x) => x.id === d.vehicleId);
  return !!v && covers(unitsFor(t, key, ctx.now()), v.orgUnitId);
}

function defectOr404(ctx: HandlerContext, key: string): DefectRow {
  const d = fleetOf(ctx.org().org).defects.find((x) => x.id === lower(ctx.params.defectId));
  if (!d || !defectVisible(ctx, d, key)) fail('not_found', 'Дефект не найден.');
  return d;
}

export const inspectionHandlers: Registry = {
  getInspectionChecklist: (ctx) => {
    const kind = ctx.query.get('kind');
    if (kind !== 'departure' && kind !== 'return') fail('malformed_request');
    vehicleOr404(ctx, uuidParam(ctx.query, 'vehicleId'));
    const list = fleetOf(ctx.org().org).checklists.find((c) => c.kind === kind);
    if (!list) fail('not_found', 'Чек-лист не опубликован.');
    return { body: structuredClone(list) };
  },

  submitInspection: (ctx) => {
    const t = ctx.org();
    const f = fleetOf(t.org);
    const b = ctx.body as S['InspectionCreate'];
    const v = vehicleOr404(ctx, b.vehicleId);
    const trip = tripOfInspection(ctx, b, v.id);
    const list = f.checklists.find((c) => c.kind === b.kind);
    if (!list || lower(b.checklistVersionId) !== list.versionId) {
      fail('validation_failed', 'Чек-лист изменился. Обновите осмотр.', {
        violations: [
          { field: 'checklistVersionId', code: 'version', message: 'Устаревшая версия' },
        ],
      });
    }
    const departure = b.kind === 'departure';
    const missing = missingOf(b, list);
    if (missing.length) {
      fail(
        'inspection_incomplete',
        `${departure ? 'Осмотр' : 'Сдача'} не завершена: ${missing.join(', ')}`,
      );
    }
    const ready = b.photos.every(
      (p) => t.org.files.find((x) => x.id === lower(p.fileId))?.status === 'ready',
    );
    if (!ready) fail('photo_not_ready', 'Не все фото загружены на сервер');
    const dep = f.inspections.find((x) => x.id === trip.departureInspectionId);
    const minOdo = Number(departure ? v.odometerKm : (dep?.odometerKm ?? v.odometerKm));
    if (Number(b.odometerKm) < minOdo) {
      const message = `Пробег не может быть меньше ${int(minOdo)} км`;
      fail('odometer_decrease', message, {
        violations: [{ field: 'odometerKm', code: 'minimum', message }],
      });
    }
    const reports = b.defects ?? [];
    if (!departure && reports.some((d) => d.severity === 'blocking')) {
      fail('validation_failed', 'Критичность дефекта выбирается только перед выездом.', {
        violations: [{ field: 'defects', code: 'severity', message: 'Только перед выездом' }],
      });
    }
    const blocking = departure && reports.some((d) => d.severity === 'blocking');
    const me = t.member?.id ?? '';
    const row: InspectionRow = {
      checklistVersionId: list.versionId,
      id: ctx.newId(),
      vehicleId: v.id,
      memberId: me,
      kind: b.kind,
      status: blocking ? 'requires_review' : 'submitted',
      odometerKm: b.odometerKm,
      fuelPercent: b.fuelPercent,
      checks: structuredClone(b.checks),
      photos: evidenceOf(t.org, b.photos),
      capturedAt: b.capturedAt,
      submittedAt: ctx.now(),
      revision: 1,
      tripId: trip.id,
      attempt: f.inspections.filter((x) => x.tripId === trip.id && x.kind === b.kind).length + 1,
      ...(b.comment ? { comment: b.comment } : {}),
    };
    f.inspections.push(row);
    const defects: DefectRow[] = reports.map((d) => ({
      id: ctx.newId(),
      vehicleId: v.id,
      inspectionId: row.id,
      tripId: trip.id,
      zone: d.zone,
      description: d.description,
      severity: d.severity,
      state: departure && d.severity === 'blocking' ? 'in_review' : 'open',
      reportedAt: ctx.now(),
      reportedByMemberId: me,
      revision: 1,
    }));
    f.defects.push(...defects);
    if (departure) {
      if (trip.state === 'assigned') trip.state = 'inspection';
      trip.departureInspectionId = row.id;
      const first = defects.find((d) => d.state === 'in_review');
      if (first) {
        trip.state = 'defect_review';
        trip.blockingDefectId = first.id;
        v.vstate = 'unavailable';
        v.note = 'критический дефект на проверке';
        v.revision++;
        notify(ctx, accountsWith(ctx, 'fleet.inspections.review', trip.orgUnitId), {
          kind: 'fleet.defect.blocking_reported',
          severity: 'critical',
          title: `Критический дефект: ${v.displayName} ${v.registrationNumber} — ${first.zone}. Выезд заблокирован.`,
          tripId: trip.id,
        });
      }
    } else {
      trip.returnInspectionId = row.id;
    }
    trip.revision++;
    return { status: 201, body: inspectionDto(f, row) };
  },

  getInspection: (ctx) => {
    const f = fleetOf(ctx.org().org);
    const i = f.inspections.find((x) => x.id === lower(ctx.params.inspectionId));
    if (!i || !inspectionVisible(ctx, i)) fail('not_found', 'Осмотр не найден.');
    return { body: inspectionDto(f, i) };
  },

  listInspections: (ctx) => {
    const f = fleetOf(ctx.org().org);
    const items = f.inspections
      .filter((i) => inspectionVisible(ctx, i))
      .map((i) => inspectionDto(f, i));
    return { body: page(items, ctx.query) };
  },

  listInspectionDefects: (ctx) => {
    const f = fleetOf(ctx.org().org);
    const states = ctx.query.getAll('state');
    if (states.some((s) => !DEFECT_STATES.includes(s))) fail('malformed_request');
    const vehicleId = uuidParam(ctx.query, 'vehicleId', false);
    const tripId = uuidParam(ctx.query, 'tripId', false);
    const items = f.defects
      .filter(
        (d) =>
          defectVisible(ctx, d, 'fleet.inspections.review') &&
          (!states.length || states.includes(d.state)) &&
          (!vehicleId || d.vehicleId === vehicleId) &&
          (!tripId || d.tripId === tripId),
      )
      .map((d) => defectDto(f, d));
    return { body: page(items, ctx.query) };
  },

  // W2.52 (0.6.1-stage2, D-29 комплекта): поля задачи у дефекта в очереди — исполнитель и срок решения.
  assignInspectionDefect: (ctx) => {
    const t = ctx.org();
    const f = fleetOf(t.org);
    const now = ctx.now();
    const d = defectOr404(ctx, 'fleet.inspections.review');
    ctx.revision(d.revision);
    if (d.state !== 'in_review') fail('invalid_transition', 'Дефект уже решён.');
    const b = ctx.body as S['DefectAssignment'];
    const v = f.vehicles.find((x) => x.id === d.vehicleId);
    const member = t.org.members.find(
      (m) => m.id === lower(b.assigneeMemberId) && m.status === 'active',
    );
    const membership = member
      ? ctx.s.memberships.find(
          (m) => m.tenantId === t.tenant.id && m.memberId === member.id && m.status === 'active',
        )
      : undefined;
    const reviews =
      !!member &&
      !!membership &&
      !!v &&
      (membership.owner ||
        covers(
          unitsFor({ ...t, membership, member, owner: false }, 'fleet.inspections.review', now),
          v.orgUnitId,
        ));
    if (!member || !reviews) {
      fail('validation_failed', 'Сотрудник не найден.', {
        violations: [
          { field: 'assigneeMemberId', code: 'unknown', message: 'Сотрудник не найден' },
        ],
      });
    }
    if (b.dueAt < now) {
      fail('validation_failed', 'Срок решения уже прошёл.', {
        violations: [{ field: 'dueAt', code: 'past', message: 'Срок уже прошёл' }],
      });
    }
    d.assigneeMemberId = member.id;
    d.assigneeDisplayName = member.displayName;
    d.dueAt = b.dueAt;
    d.assignedByMemberId = t.member?.id ?? '';
    d.assignedAt = now;
    d.revision++;
    if (member.id !== t.member?.id) {
      notify(ctx, accountOf(t.org, member.id), {
        kind: 'fleet.defect.assigned',
        severity: 'warning',
        title: `Вам назначен дефект: ${v?.displayName ?? ''} ${v?.registrationNumber ?? ''} — ${d.zone}`,
        ...(d.tripId ? { tripId: d.tripId } : {}),
      });
    }
    return { body: defectDto(f, d) };
  },

  getInspectionDefect: (ctx) => ({
    body: defectDto(fleetOf(ctx.org().org), defectOr404(ctx, 'fleet.inspections.read')),
  }),

  decideInspectionDefect: (ctx) => {
    const t = ctx.org();
    const f = fleetOf(t.org);
    const d = defectOr404(ctx, 'fleet.inspections.review');
    ctx.revision(d.revision);
    if (d.state !== 'in_review') fail('invalid_transition', 'Дефект уже решён.');
    const b = ctx.body as S['DefectDecision'];
    d.decision = b.decision;
    if (b.comment) d.decisionComment = b.comment;
    d.decidedByMemberId = t.member?.id ?? '';
    d.decidedAt = ctx.now();
    d.revision++;
    const insp = f.inspections.find((x) => x.id === d.inspectionId);
    const trip = d.tripId ? f.trips.find((x) => x.id === d.tripId) : undefined;
    const v = f.vehicles.find((x) => x.id === d.vehicleId);
    if (b.decision === 'allow_departure') {
      d.state = 'resolved';
      const open = f.defects.some(
        (x) => x.inspectionId === d.inspectionId && x.state === 'in_review',
      );
      if (!open) {
        if (insp) {
          insp.status = 'approved';
          insp.revision++;
        }
        if (trip?.state === 'defect_review') {
          trip.state = 'inspection';
          delete trip.blockingDefectId;
          trip.revision++;
          if (v) {
            v.vstate = 'reserved';
            v.heldBy = trip.id;
            delete v.note;
            v.revision++;
          }
        }
      }
      notify(ctx, accountOf(t.org, trip?.driverMemberId), {
        kind: 'fleet.defect.decided',
        severity: 'info',
        title: 'Менеджер разрешил выезд: дефект признан некритичным',
        ...(trip ? { tripId: trip.id } : {}),
      });
    } else {
      d.state = 'confirmed_out_of_service';
      if (insp) {
        insp.status = 'rejected';
        insp.revision++;
      }
      if (v) {
        v.vstate = 'unavailable';
        v.note = 'неисправность подтверждена';
        delete v.heldBy;
        v.revision++;
      }
      if (trip && trip.state === 'defect_review') {
        releaseHold(f, trip);
        trip.state = 'planned';
        delete trip.vehicleId;
        delete trip.departureInspectionId;
        delete trip.blockingDefectId;
        trip.revision++;
      }
      notify(ctx, accountOf(t.org, trip?.driverMemberId), {
        kind: 'fleet.defect.decided',
        severity: 'warning',
        title:
          `Неисправность подтверждена. Выберите другую машину для рейса ${trip?.number ?? ''}`.trim(),
        ...(trip ? { tripId: trip.id } : {}),
      });
    }
    return { body: defectDto(f, d) };
  },
};
