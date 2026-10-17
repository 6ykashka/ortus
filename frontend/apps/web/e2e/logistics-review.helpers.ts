// W2.21 · Помощники e2e страниц логиста «Приёмка смен», «Очередь блокирующих дефектов», «Начисления водителям»:
// смена водителя Р-208 через API из сессии водителя (как экран W2.22: бронь ГАЗели, пять фото осмотра выезда, старт,
// «Завершить рейс», расход с чеком, пять фото осмотра сдачи, сдача), блокирующий дефект «Стёкла: Скол». Фото — сессия
// загрузки (initiate → complete) и проверка файлов сценарного сервера (`scanFiles`, только mock).
import type { Persona } from '@ortus/e2e-kit';
import type { Locator, Page } from '@playwright/test';

import { call, devScenario, type Reply, tenantId } from './shell.helpers.ts';

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<unknown>;

const ROLES = ['front', 'rear', 'left', 'right', 'odometer'] as const;
const SHA = 'a3f1c9e2b7d4058e6c1f2a9b3d7e4c5f8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d';
const NOW = '2026-10-01T07:30:00Z';

export const REVIEW_H1 = 'Приёмка смен';

export const phone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 640;

interface Plan {
  id: string;
  number: string;
  driverMemberId?: string;
  plannedWindow: unknown;
  revision: number;
}

const ok = (r: Reply, what: string, status = [200, 201]): Reply => {
  if (!status.includes(r.status)) throw new Error(`${what} ${r.status}: ${JSON.stringify(r.body)}`);
  return r;
};

const body = <T>(r: Reply): T => r.body as T;

/** Рейс по номеру (listTripPlans) из сессии страницы. */
export async function tripByNumber(page: Page, tenant: string, number = 'Р-208'): Promise<Plan> {
  const r = ok(
    await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/trip-plans?limit=200`),
    'listTripPlans',
  );
  const t = body<{ items: Plan[] }>(r).items.find((x) => x.number === number);
  if (!t) throw new Error(`нет рейса ${number}`);
  return t;
}

/** ETag свежего getTripPlan (If-Match команд рейса). */
async function tripEtag(page: Page, tenant: string, tripId: string): Promise<string> {
  const r = ok(
    await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/trip-plans/${tripId}`),
    'getTripPlan',
  );
  return r.headers.etag ?? '';
}

/** Готовые файлы: сессия загрузки → complete → проверка файлов (mock). */
async function readyFiles(
  page: Page,
  tenant: string,
  n: number,
  purpose: 'inspection' | 'expense_receipt',
  owner: { entityType: string; entityId: string },
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = ok(
      await call(page, 'POST', `/api/v1/tenants/${tenant}/files/uploads`, {
        body: {
          fileName: `${purpose}-${i + 1}.jpg`,
          contentType: 'image/jpeg',
          sizeBytes: 245760,
          sha256: SHA,
          purpose,
          owner: { moduleKey: 'fleet', ...owner },
        },
      }),
      'initiateUpload',
    );
    const t = body<{ uploadId: string; fileId: string }>(r);
    ok(
      await call(page, 'POST', `/api/v1/tenants/${tenant}/files/uploads/${t.uploadId}/complete`, {
        body: { sha256: SHA },
      }),
      'completeUpload',
      [200, 202],
    );
    ids.push(t.fileId);
  }
  ok(await call(page, 'POST', '/api/v1/dev/scenario', { body: { scanFiles: true } }), 'scanFiles');
  return ids;
}

async function inspect(
  page: Page,
  tenant: string,
  o: {
    kind: 'departure' | 'return';
    vehicleId: string;
    tripId: string;
    reservationId?: string;
    odometerKm: string;
    defects?: { zone: string; description: string; severity: 'blocking' | 'minor' }[];
    comment?: string;
  },
): Promise<string> {
  const list = body<{ versionId: string; items: { key: string }[] }>(
    ok(
      await call(
        page,
        'GET',
        `/api/v1/tenants/${tenant}/fleet/inspection-checklist?vehicleId=${o.vehicleId}&kind=${o.kind}`,
      ),
      'getInspectionChecklist',
    ),
  );
  const owner =
    o.kind === 'departure'
      ? { entityType: 'reservation', entityId: o.reservationId ?? '' }
      : { entityType: 'trip', entityId: o.tripId };
  const files = await readyFiles(page, tenant, ROLES.length, 'inspection', owner);
  const r = ok(
    await call(page, 'POST', `/api/v1/tenants/${tenant}/fleet/inspections`, {
      body: {
        checklistVersionId: list.versionId,
        vehicleId: o.vehicleId,
        kind: o.kind,
        ...(o.reservationId ? { reservationId: o.reservationId } : { tripId: o.tripId }),
        odometerKm: o.odometerKm,
        fuelPercent: 50,
        checks: list.items.map((i) => ({ key: i.key, result: 'pass' })),
        photos: ROLES.map((role, i) => ({ role, fileId: files[i], capturedAt: NOW })),
        capturedAt: NOW,
        ...(o.defects ? { defects: o.defects } : {}),
        ...(o.comment ? { comment: o.comment } : {}),
      },
    }),
    'submitInspection',
  );
  return body<{ id: string }>(r).id;
}

export interface ShiftOptions {
  /** Блокирующий дефект «Стёкла: Скол» при осмотре выезда — смена остаётся на проверке менеджера. */
  defect?: boolean;
  /** Расход «Топливо» 2 500 ₽ с чеком (по умолчанию — да). */
  expense?: boolean;
  /** Ещё расходы этих категорий (контракт 0.5.1-stage2) по 1 200 ₽ с чеком; у «other» — комментарий. */
  kinds?: readonly ('wash' | 'parking' | 'toll' | 'tire_service' | 'other')[];
}

/**
 * Пресет `logistics-ready` (владелец), затем водитель (Илья Васильев) проводит смену Р-208 через API. Возвращает id
 * организации и рейса; страница остаётся в сессии водителя.
 */
export async function driverShift(
  app: AppFn,
  page: Page,
  o: ShiftOptions = {},
): Promise<{ tenant: string; tripId: string }> {
  await app('/', { persona: 'owner' });
  const tenant = await tenantId(page);
  await devScenario(page, { preset: 'logistics-ready' });
  await app('/', { persona: 'driver' });
  const trip = await tripByNumber(page, tenant);
  const vehicles = body<{ items: { id: string; displayName: string }[] }>(
    ok(
      await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/vehicles?limit=200`),
      'listVehicles',
    ),
  ).items;
  const gazel = vehicles.find((v) => v.displayName === 'ГАЗель Next');
  if (!gazel) throw new Error('нет ГАЗели');
  const reservation = body<{ id: string }>(
    ok(
      await call(page, 'POST', `/api/v1/tenants/${tenant}/fleet/reservations`, {
        body: {
          vehicleId: gazel.id,
          driverMemberId: trip.driverMemberId,
          window: trip.plannedWindow,
          tripId: trip.id,
        },
      }),
      'reserveVehicle',
    ),
  );
  const departure = await inspect(page, tenant, {
    kind: 'departure',
    vehicleId: gazel.id,
    tripId: trip.id,
    reservationId: reservation.id,
    odometerKm: '84500',
    ...(o.defect
      ? { defects: [{ zone: 'Стёкла', description: 'Скол', severity: 'blocking' as const }] }
      : {}),
  });
  if (o.defect) return { tenant, tripId: trip.id };
  ok(
    await call(page, 'POST', `/api/v1/tenants/${tenant}/fleet/trips`, {
      body: { reservationId: reservation.id, departureInspectionId: departure },
    }),
    'startTrip',
  );
  ok(
    await call(page, 'POST', `/api/v1/tenants/${tenant}/fleet/trips/${trip.id}/route-completion`, {
      ifMatch: await tripEtag(page, tenant, trip.id),
    }),
    'finishTripRoute',
  );
  if (o.expense !== false) {
    const [receipt] = await readyFiles(page, tenant, 1, 'expense_receipt', {
      entityType: 'trip',
      entityId: trip.id,
    });
    ok(
      await call(page, 'POST', `/api/v1/tenants/${tenant}/fleet/trips/${trip.id}/expenses`, {
        body: {
          kind: 'fuel',
          occurredAt: NOW,
          amount: { amountMinor: 250000, currency: 'RUB' },
          receiptFileIds: [receipt],
          comment: 'АЗС на Ленинградском шоссе',
        },
      }),
      'createTripExpense',
    );
  }
  for (const kind of o.kinds ?? []) {
    const [receipt] = await readyFiles(page, tenant, 1, 'expense_receipt', {
      entityType: 'trip',
      entityId: trip.id,
    });
    ok(
      await call(page, 'POST', `/api/v1/tenants/${tenant}/fleet/trips/${trip.id}/expenses`, {
        body: {
          kind,
          occurredAt: NOW,
          amount: { amountMinor: 120000, currency: 'RUB' },
          receiptFileIds: [receipt],
          ...(kind === 'other' ? { comment: 'Ключи от склада' } : {}),
        },
      }),
      `createTripExpense ${kind}`,
    );
  }
  const ret = await inspect(page, tenant, {
    kind: 'return',
    vehicleId: gazel.id,
    tripId: trip.id,
    odometerKm: '84560',
  });
  ok(
    await call(page, 'PATCH', `/api/v1/tenants/${tenant}/fleet/trips/${trip.id}`, {
      body: { action: 'return', returnInspectionId: ret },
      ifMatch: await tripEtag(page, tenant, trip.id),
    }),
    'returnTrip',
  );
  return { tenant, tripId: trip.id };
}

/** Пункт меню по подписи: на телефоне — короткая подпись нижней навигации или «Ещё» → «Все разделы». */
export async function fromMenu(page: Page, label: string, short?: string): Promise<void> {
  if (phone(page)) {
    const bottom = page.getByRole('navigation', { name: 'Навигация', exact: true });
    const direct = bottom.getByRole('button', { name: short ?? label, exact: true });
    if (short && (await direct.count())) await direct.click();
    else {
      await bottom.getByRole('button', { name: 'Ещё' }).click();
      await page
        .getByRole('dialog', { name: 'Все разделы' })
        .getByRole('button', { name: label })
        .click();
    }
  } else {
    await page
      .getByRole('navigation', { name: 'Основная навигация' })
      .getByRole('button', { name: label })
      .click();
  }
}

export const review = (page: Page): Locator => page.locator('section[aria-labelledby="h-rev"]');

/** Кнопка смены в очереди по номеру рейса. */
export const queueItem = (page: Page, trip = 'Р-208'): Locator =>
  review(page).locator('.ox-rv-queue-item').filter({ hasText: trip });

/** Значение статистики карточки смены по подписи. */
export const statValue = (page: Page, label: string): Locator =>
  page
    .locator('.ox-rv-stat')
    .filter({ has: page.locator('.ox-rv-stat-label', { hasText: label }) })
    .locator('.ox-rv-stat-value');
