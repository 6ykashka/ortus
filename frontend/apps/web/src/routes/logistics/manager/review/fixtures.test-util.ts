// W2.21 · Положения смены Р-208 «Альты» для экранных тестов логиста: правка состояния сценарного сервера W2.00 до
// первого запроса (как после команд водителя: бронь ГАЗели, осмотр выезда с пятью фото, старт, «Завершить рейс»,
// осмотр сдачи, сдача; блокирующий дефект «Стёкла: Скол» — осмотр выезда ушёл менеджеру). Поля — строки MSW fleet.
import type { components } from '@ortus/api-client';
import type { ScenarioServer } from '@ortus/adapter/msw';
import { seedUuid } from '@ortus/domain/seed';

type S = components['schemas'];

export const ALTA = seedUuid('platform', 't-alta');
export const A = (id: string): string => seedUuid('t-alta', id);

const ROLES = ['front', 'rear', 'left', 'right', 'odometer'] as const;
const AT = '2026-10-01T05:47:00Z';
const RET_AT = '2026-10-01T10:20:00Z';

interface Row {
  id: string;
  proto?: string;
  number?: string;
  state?: string;
  vstate?: string;
  heldBy?: string;
  note?: string;
  revision: number;
  [k: string]: unknown;
}

interface Fleet {
  vehicles: Row[];
  trips: Row[];
  reservations: Row[];
  inspections: Row[];
  defects: Row[];
  expenses: S['TripExpense'][];
  earnings: S['TripEarnings'][];
}

interface OrgLike {
  files: {
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    status: string;
    createdAt: string;
  }[];
  fleet?: Fleet;
}

const uuid = (n: number): string => `5e2a7c10-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function fleetOf(scenario: ScenarioServer): Fleet {
  const org = scenario.state().orgs[ALTA] as unknown as OrgLike | undefined;
  if (!org?.fleet) throw new Error('в состоянии нет логистики «Альты»');
  return org.fleet;
}

function readyFiles(scenario: ScenarioServer, prefix: string, n: number): string[] {
  const org = scenario.state().orgs[ALTA] as unknown as OrgLike;
  return Array.from({ length: n }, (_, i) => {
    const id = uuid(1000 + org.files.length + 1);
    org.files.push({
      id,
      fileName: `${prefix}-${i + 1}.jpg`,
      contentType: 'image/jpeg',
      sizeBytes: 2457600,
      sha256: 'a3f1c9e2b7d4058e6c1f2a9b3d7e4c5f8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d',
      status: 'ready',
      createdAt: AT,
    });
    return id;
  });
}

function inspection(
  scenario: ScenarioServer,
  kind: 'departure' | 'return',
  tripId: string,
  vehicleId: string,
  o: { odometerKm: string; status: string; at: string; comment?: string },
): Row {
  const f = fleetOf(scenario);
  const files = readyFiles(scenario, kind, ROLES.length);
  const row: Row = {
    checklistVersionId: seedUuid('t-alta', `checklist:${kind}:1`),
    id: uuid(kind === 'departure' ? 501 : 502),
    vehicleId,
    memberId: A('m-vasiliev'),
    kind,
    status: o.status,
    odometerKm: o.odometerKm,
    fuelPercent: 50,
    checks: [],
    photos: ROLES.map((role, i) => ({ role, fileId: files[i], capturedAt: o.at })),
    capturedAt: o.at,
    submittedAt: o.at,
    revision: 1,
    tripId,
    attempt: 1,
    ...(o.comment ? { comment: o.comment } : {}),
  };
  f.inspections.push(row);
  return row;
}

const trip208 = (f: Fleet): Row => {
  const t = f.trips.find((x) => x.number === 'Р-208');
  if (!t) throw new Error('нет рейса Р-208');
  return t;
};

const gazel = (f: Fleet): Row => {
  const v = f.vehicles.find((x) => x.proto === 'v1');
  if (!v) throw new Error('нет ГАЗели');
  return v;
};

/**
 * Р-208 сдан водителем: осмотры 84 500 → 84 560 км, топливо ½ → ½, расход «Топливо» 2 500 ₽ с чеком; `extra` —
 * ещё расходы указанных категорий.
 */
export function submittedShift(
  scenario: ScenarioServer,
  o: { expense?: boolean; comment?: string; extra?: readonly S['TripExpense']['kind'][] } = {},
): { tripId: string } {
  const f = fleetOf(scenario);
  const t = trip208(f);
  const v = gazel(f);
  const dep = inspection(scenario, 'departure', t.id, v.id, {
    odometerKm: '84500',
    status: 'submitted',
    at: AT,
  });
  const ret = inspection(scenario, 'return', t.id, v.id, {
    odometerKm: '84560',
    status: 'submitted',
    at: RET_AT,
    ...(o.comment ? { comment: o.comment } : {}),
  });
  Object.assign(t, {
    vehicleId: v.id,
    departureInspectionId: dep.id,
    returnInspectionId: ret.id,
    startedAt: AT,
    routeCompletedAt: RET_AT,
    returnedAt: RET_AT,
    state: 'submitted',
  });
  t.revision += 6;
  Object.assign(v, { vstate: 'review', heldBy: t.id });
  v.revision++;
  if (o.expense !== false) {
    const [receipt] = readyFiles(scenario, 'receipt', 1);
    f.expenses.push({
      id: uuid(601),
      tripId: t.id,
      kind: 'fuel',
      occurredAt: '2026-10-01T08:10:00Z',
      amount: { amountMinor: 250000, currency: 'RUB' },
      receiptFileIds: [receipt ?? ''],
      reviewState: 'pending',
      revision: 1,
    });
  }
  // Расходы других категорий (без чека): по 1 200 ₽, «Прочее» — с комментарием (D-12, W2.40).
  (o.extra ?? []).forEach((kind, i) => {
    f.expenses.push({
      id: uuid(611 + i),
      tripId: t.id,
      kind,
      occurredAt: '2026-10-01T09:00:00Z',
      amount: { amountMinor: 120000, currency: 'RUB' },
      receiptFileIds: [],
      reviewState: 'pending',
      revision: 1,
      ...(kind === 'other' ? { comment: 'Ключи от склада' } : {}),
    });
  });
  return { tripId: t.id };
}

/** Р-208 принят менеджером (Котова): машина свободна, начисление водителю 4 500 ₽ (reviewTrip approve, Q-55). */
export function acceptedShift(scenario: ScenarioServer): { tripId: string } {
  const { tripId } = submittedShift(scenario);
  const f = fleetOf(scenario);
  const t = trip208(f);
  const v = gazel(f);
  const at = '2026-10-01T11:42:00Z';
  Object.assign(t, {
    state: 'accepted',
    acceptedAt: at,
    reviews: [{ decision: 'approve', attempt: 1, reviewerMemberId: A('m-kotova'), reviewedAt: at }],
  });
  t.revision++;
  Object.assign(v, { vstate: 'free', odometerKm: '84560' });
  delete v.heldBy;
  v.revision++;
  f.earnings.push({
    tripId,
    driverMemberId: A('m-vasiliev'),
    amount: { amountMinor: 450000, currency: 'RUB' },
    updatedByMemberId: A('m-kotova'),
    updatedAt: at,
    revision: 1,
  });
  return { tripId };
}

/** Р-208 на проверке менеджера: осмотр выезда с критическим дефектом «Стёкла: Скол», выезд заблокирован. */
export function blockingDefect(scenario: ScenarioServer): { tripId: string; defectId: string } {
  const f = fleetOf(scenario);
  const t = trip208(f);
  const v = gazel(f);
  const dep = inspection(scenario, 'departure', t.id, v.id, {
    odometerKm: '84500',
    status: 'requires_review',
    at: AT,
  });
  const defectId = uuid(701);
  f.defects.push({
    id: defectId,
    vehicleId: v.id,
    inspectionId: dep.id,
    tripId: t.id,
    zone: 'Стёкла',
    description: 'Скол',
    severity: 'blocking',
    state: 'in_review',
    reportedAt: AT,
    reportedByMemberId: A('m-vasiliev'),
    revision: 1,
  });
  const reservationId = uuid(801);
  f.reservations.push({
    id: reservationId,
    vehicleId: v.id,
    driverMemberId: A('m-vasiliev'),
    window: t.plannedWindow,
    state: 'held',
    holdExpiresAt: '2026-10-01T08:00:00Z',
    revision: 1,
    tripId: t.id,
  });
  Object.assign(t, {
    vehicleId: v.id,
    reservationId,
    departureInspectionId: dep.id,
    blockingDefectId: defectId,
    state: 'defect_review',
  });
  t.revision += 3;
  Object.assign(v, { vstate: 'unavailable', heldBy: t.id, note: 'критический дефект на проверке' });
  v.revision++;
  return { tripId: t.id, defectId };
}
