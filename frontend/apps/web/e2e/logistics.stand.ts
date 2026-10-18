// W2.53 · Помощники строк @stand страниц логистики этапа 2 (logistics-fleet, -plan, -defects, -review, -earnings,
// driver-today, driver-cars, modal-finish-route, journeys/stage2) на сиде e2e-stand (tools/ci/e2e-stand.mjs).
//
// Стенд общий для всех строк и трёх проектов прогона (workers 1), поэтому строка сама готовит и возвращает сид:
//   - «Логистика» в «Альте» на базовом сиде не подключена (Q-W2.90-1, на этом стоит access-gate @stand). Строка
//     подключает её и выдаёт Марине Котовой «Менеджер логистики» в «Север Логистик» с поддеревом (как seed demo и
//     пресет MSW logistics-ready), а в уборке снимает назначение и отключает модуль с `owner_export` — модуль
//     полностью отключён, для гейта водителя это то же «не подключена организацией». На сиде показа (seed demo) всё
//     уже есть — уборки нет;
//   - рейсы: строка берёт свой рейс (createTripPlan с меткой прогона) и доводит смену до приёмки, чтобы следующий
//     проект не увидел чужой активной смены; машина возвращается в пул приёмкой или снятием брони;
//   - фото — настоящий JPEG из canvas через presigned PUT в MinIO и проверку cmd/worker. Если хранилище стенда браузеру
//     недоступно (e2e-stand поднимает compose без MinIO и не пускает его хост в E2E_ALLOW_HOSTS), строки с фото
//     пропускаются с этой причиной (integratorNotes W2.53).
// Часы страниц — настоящие: окна рейсов стенда считаются от «сейчас» сервера.
import { expect, type Locator, type Page } from '@playwright/test';

import type { Session, Undo } from './_stand/fixtures.ts';
import { assign, assignmentsOf, expectStatus, listUnits, roleId } from './_stand/stand.ts';
import { call, type Reply, tenantId } from './shell.helpers.ts';

export const KOTOVA = 'm.kotova@alta.example';
export const VASILIEV = 'i.vasiliev@alta.example';
export const AKHMEDOV = 'Тимур Ахмедов';
/** subject сида Тимура Ахмедова (backend/cmd/seed/platform.go): водитель по профилю, без роли в базовом сиде. */
const AKHMEDOV_SUBJECT = 'acc-9';
const AKHMEDOV_EMAIL = 't.akhmedov@alta.example';
export const MANAGER_ROLE = 'Менеджер логистики';
export const DRIVER_ROLE = 'Водитель';
export const UNIT = 'Север Логистик';
export const GAZEL = 'ГАЗель Next';
/** Пять ракурсов осмотра (InspectionPhoto.role). */
const ROLES = ['front', 'rear', 'left', 'right', 'odometer'] as const;

/** Причина пропуска строк с фото на стенде без хранилища. */
export const NO_STORAGE =
  'хранилище стенда недоступно браузеру: e2e-stand поднимает compose без MinIO и не добавляет его хост в ' +
  'E2E_ALLOW_HOSTS — фото не загрузить (integratorNotes W2.53; строка проходит на стенде с MinIO, как demo-stand.mjs)';

export interface Plan {
  id: string;
  number: string;
  title: string;
  state: string;
  revision: number;
  driverMemberId?: string;
  driverDisplayName?: string;
  vehicleId?: string;
  reservationId?: string;
  plannedWindow: { startsAt: string; endsAt: string; timeZone: string };
}

export interface Vehicle {
  id: string;
  displayName: string;
  registrationNumber: string;
  odometerKm: string;
  status: string;
  orgUnitId: string;
}

export interface LogisticsStand {
  tenant: string;
  /** Владелец «Альты» в своём контексте (команды владельца и уборка). */
  owner: Page;
  /** «Север Логистик». */
  unitId: string;
  members: { kotova: string; vasiliev: string; akhmedov: string };
}

const ok = (r: Reply, what: string): Reply => {
  expect(r.status < 300, `${what} ${r.status}: ${JSON.stringify(r.body)}`).toBe(true);
  return r;
};

/** Настоящие часы страницы (харнесс ставит фиксированные 01.10.2026). */
export async function realClock(page: Page): Promise<void> {
  await page.clock.setSystemTime(new Date());
}

async function memberId(owner: Page, tenant: string, email: string): Promise<string> {
  const r = ok(
    await call(owner, 'GET', `/api/v1/tenants/${tenant}/members?limit=200`),
    'listMembers',
  );
  const m = (r.body as { items: { id: string; email?: string }[] }).items.find(
    (x) => x.email === email,
  );
  if (!m) throw new Error(`нет участника ${email}`);
  return m.id;
}

/** Роль в «Север Логистик» с поддеревом, если её ещё нет; снятие — в уборке. */
async function grant(
  s: LogisticsStand,
  undo: Undo,
  member: string,
  role: string,
  label: string,
): Promise<void> {
  const id = await roleId(s.owner, s.tenant, role);
  const has = (await assignmentsOf(s.owner, s.tenant, member)).some((a) => a.roleId === id);
  if (has) return;
  const a = await assign(s.owner, s.tenant, { memberId: member, roleId: id, unitId: s.unitId });
  undo(`${label} — «${role}»`, async () => {
    const r = await call(s.owner, 'DELETE', `/api/v1/tenants/${s.tenant}/assignments/${a.id}`);
    if (r.status !== 204 && r.status !== 404) expectStatus(r, 204, 'revokeAssignment');
  });
}

/**
 * «Логистика» в «Альте» и Котова — «Менеджер логистики» (как seed demo); `drivers` — ещё и Тимур Ахмедов с ролью
 * «Водитель» (второй водитель строк, которые ведут смену через API). Уборка возвращает базовый сид.
 */
export async function logisticsOn(
  session: () => Promise<Session>,
  undo: Undo,
  o: { akhmedov?: boolean } = {},
): Promise<LogisticsStand> {
  const s = await session();
  await s.open('/', 'owner');
  await realClock(s.page);
  const tenant = await tenantId(s.page);
  const path = `/api/v1/tenants/${tenant}/modules/fleet`;
  const cur = ok(await call(s.page, 'GET', path), 'getModuleInstallation');
  if ((cur.body as { state: string }).state !== 'active') {
    const on = await call(s.page, 'PUT', path, {
      body: { enabled: true, reason: 'W2.53: стенд-e2e страниц логистики' },
      ifMatch: cur.headers.etag ?? '',
    });
    ok(on, 'setModuleInstallation enabled');
    undo('«Логистика» «Альты»', async () => {
      const now = ok(await call(s.page, 'GET', path), 'getModuleInstallation');
      const off = await call(s.page, 'PUT', path, {
        body: {
          enabled: false,
          retainedAccess: 'owner_export',
          reason: 'W2.53: возврат базового сида после стенд-e2e',
        },
        ifMatch: now.headers.etag ?? '',
      });
      ok(off, 'setModuleInstallation disabled');
      expect((off.body as { state: string }).state, 'модуль без активных смен').toBe('disabled');
    });
  }
  const unit = (await listUnits(s.page, tenant)).find((u) => u.name === UNIT);
  if (!unit) throw new Error(`нет подразделения «${UNIT}»`);
  const stand: LogisticsStand = {
    tenant,
    owner: s.page,
    unitId: unit.id,
    members: {
      kotova: await memberId(s.page, tenant, KOTOVA),
      vasiliev: await memberId(s.page, tenant, VASILIEV),
      akhmedov: await memberId(s.page, tenant, AKHMEDOV_EMAIL),
    },
  };
  await grant(stand, undo, stand.members.kotova, MANAGER_ROLE, 'Марина Котова');
  if (o.akhmedov) await grant(stand, undo, stand.members.akhmedov, DRIVER_ROLE, AKHMEDOV);
  // Уборка идёт в обратном порядке: входящие читаются первыми, пока роль и модуль на месте.
  undo('уведомления владельца «Альты»', () => readInbox(s.page, tenant));
  return stand;
}

const unread = async (owner: Page, tenant: string): Promise<number> => {
  const r = ok(
    await call(owner, 'GET', '/api/v1/me/notifications/summary'),
    'getMyNotificationSummary',
  );
  const t = (r.body as { tenants: { tenantId: string; unreadCount: number }[] }).tenants;
  return t.find((x) => x.tenantId === tenant)?.unreadCount ?? 0;
};

/**
 * Входящие владельца «Альты» прочитаны (inbox @stand ждёт «Новых событий нет»): события смен и дефектов строки
 * cmd/worker раскладывает асинхронно, поэтому чтение повторяется, пока непрочитанных нет две проверки подряд.
 */
async function readInbox(owner: Page, tenant: string): Promise<void> {
  let quiet = 0;
  for (let i = 0; i < 20 && quiet < 2; i++) {
    if ((await unread(owner, tenant)) === 0) {
      quiet++;
    } else {
      quiet = 0;
      ok(
        await call(owner, 'POST', '/api/v1/me/notifications/read', {
          body: { tenantId: tenant, upTo: new Date(Date.now() + 1000).toISOString() },
        }),
        'markNotificationsRead',
      );
    }
    await owner.waitForTimeout(1500);
  }
  expect(await unread(owner, tenant), 'входящие владельца прочитаны').toBe(0);
}

/** Тимур Ахмедов в своём контексте: dev-вход subject сида (персонажа харнесса у него нет). */
export async function akhmedov(session: () => Promise<Session>): Promise<Page> {
  const s = await session();
  await s.open('/auth/login');
  await realClock(s.page);
  ok(
    await call(s.page, 'POST', '/api/v1/dev/login', { body: { persona: AKHMEDOV_SUBJECT } }),
    'dev-вход Тимура Ахмедова',
  );
  return s.page;
}

/** Персонаж харнесса в своём контексте с настоящими часами. */
export async function persona(
  session: () => Promise<Session>,
  who: 'manager' | 'owner' | 'driver',
  route = '/',
): Promise<Page> {
  const s = await session();
  await s.open(route, who);
  await realClock(s.page);
  return s.page;
}

export async function plans(page: Page, tenant: string): Promise<Plan[]> {
  const r = ok(
    await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/trip-plans?limit=200`),
    'listTripPlans',
  );
  return (r.body as { items: Plan[] }).items;
}

export async function plan(page: Page, tenant: string, id: string): Promise<Reply> {
  return ok(
    await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/trip-plans/${id}`),
    'getTripPlan',
  );
}

export async function vehicles(page: Page, tenant: string): Promise<Vehicle[]> {
  const r = ok(
    await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/vehicles?limit=200`),
    'listVehicles',
  );
  return (r.body as { items: Vehicle[] }).items;
}

export async function vehicle(page: Page, tenant: string, name = GAZEL): Promise<Vehicle> {
  const v = (await vehicles(page, tenant)).find((x) => x.displayName === name);
  if (!v) throw new Error(`нет машины «${name}»`);
  return v;
}

const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
/** Количество контракта (Quantity): десятичная строка без лишних нулей. */
const q = (n: number): string => String(Math.round(n * 10) / 10);
const HOUR = 3_600_000;

/** Метка прогона: проект и время — названия рейсов не пересекаются между проектами и прогонами. */
export const label = (project: string): string =>
  `${project.replace(/^(\w)\w*-(\d+)$/, '$1$2')}·${Date.now().toString(36).slice(-5)}`;

/**
 * Конец последнего окна, в котором машина ещё занята, мс (нет — 0): брони `held` и `consumed` (listReservations) и
 * рейсы с этой машиной не в `planned` — назначение логиста (assignTripVehicle) держит машину бронью без водителя, а
 * её listReservations не отдаёт.
 */
async function bookedUntil(manager: Page, tenant: string, vehicleId: string): Promise<number> {
  const r = ok(
    await call(manager, 'GET', `/api/v1/tenants/${tenant}/fleet/reservations?limit=200`),
    'listReservations',
  );
  const items = (
    r.body as { items: { vehicleId: string; state: string; window: { endsAt: string } }[] }
  ).items;
  const held = items
    .filter((x) => x.vehicleId === vehicleId && (x.state === 'held' || x.state === 'consumed'))
    .map((x) => Date.parse(x.window.endsAt));
  const trips = (await plans(manager, tenant))
    .filter((p) => p.vehicleId === vehicleId && p.state !== 'planned')
    .map((p) => Date.parse(p.plannedWindow.endsAt));
  return Math.max(0, ...held, ...trips);
}

/**
 * Свой рейс строки под груз ГАЗели (как Р-208), окно 2 ч. Окно начинается не раньше «сейчас + 5 мин» и после
 * последнего окна, в котором занята машина строки (`vehicle`, по умолчанию ГАЗель): бронь смены, начатой до своего
 * окна, после приёмки (`consumed`) держит машину до конца окна, а назначение логиста снять нечем — бронь и назначение на
 * пересекающееся окно сервер отклоняет 409 (вопросы W2.53). Водитель занят в это время другим незавершённым рейсом
 * (409 resources_unavailable) — окно сдвигается на 2 ч. `light` — лёгкий груз для любой машины фирмы.
 */
export async function newTrip(
  manager: Page,
  s: LogisticsStand,
  o: { title: string; driverMemberId?: string; vehicle?: string; light?: boolean },
): Promise<Plan> {
  const v = await vehicle(manager, s.tenant, o.vehicle ?? GAZEL);
  const from = Math.max(
    Date.now() + 5 * 60_000,
    (await bookedUntil(manager, s.tenant, v.id)) + 60_000,
  );
  // Лёгкий груз (0,5 т, 5 м³, кузов от 2 м) подходит и Ford Transit, и Hyundai Porter.
  const k = o.light ? 0.4 : 1;
  for (let shift = 0; shift < 24; shift++) {
    const start = Math.ceil((from + shift * 2 * HOUR) / 60_000) * 60_000;
    const window = {
      startsAt: iso(start),
      endsAt: iso(start + 2 * HOUR),
      timeZone: 'Europe/Moscow',
    };
    const r = await call(manager, 'POST', `/api/v1/tenants/${s.tenant}/fleet/trip-plans`, {
      body: {
        orgUnitId: s.unitId,
        title: o.title,
        plannedWindow: window,
        distanceKm: '46',
        cargo: {
          description: o.light ? 'Сухой груз · 5 паллет-мест' : 'Сухой груз · 14 паллет-мест',
          weightKg: q(1100 * k),
          volumeM3: q(12 * k),
          lengthM: o.light ? '2' : '3',
        },
        stops: [
          {
            sequence: 1,
            op: 'load',
            address: 'Склад № 1, Лобня',
            weightKg: q(1100 * k),
            volumeM3: q(12 * k),
            plannedAt: window.startsAt,
          },
          {
            sequence: 2,
            op: 'unload',
            address: 'Химки, ул. Заводская, 8',
            weightKg: q(700 * k),
            volumeM3: q(8 * k),
            plannedAt: iso(start + 40 * 60_000),
          },
          {
            sequence: 3,
            op: 'unload',
            address: 'Долгопрудный, Лихачёвский пр., 4',
            weightKg: q(400 * k),
            volumeM3: q(4 * k),
            plannedAt: iso(start + 80 * 60_000),
          },
        ],
        ...(o.driverMemberId ? { driverMemberId: o.driverMemberId } : {}),
      },
    });
    if (r.status === 201) return r.body as Plan;
    if ((r.body as { code?: string }).code !== 'resources_unavailable') ok(r, 'createTripPlan');
  }
  throw new Error('createTripPlan: водитель занят во всех окнах ближайших двух суток');
}

const ACTIVE = new Set([
  'planned',
  'assigned',
  'inspection',
  'defect_review',
  'on_route',
  'returning',
  'submitted',
  'rework',
]);

/** Рейс, который «Моя смена» покажет водителю: первый незавершённый по окну (pickTrip экрана W2.22). */
export function shown(list: readonly Plan[]): Plan | undefined {
  return [...list]
    .sort((a, b) => a.plannedWindow.startsAt.localeCompare(b.plannedWindow.startsAt))
    .find((p) => ACTIVE.has(p.state));
}

/**
 * Смена водителя для строки экрана водителя: незавершённый рейс, который покажет «Моя смена», если он ещё не начат
 * (`planned`), иначе новый рейс этого водителя. Смену, которую оставила упавшая строка, сначала закрывает closeTrip.
 */
export async function driverTrip(
  driver: Page,
  manager: Page,
  s: LogisticsStand,
  title: string,
): Promise<Plan> {
  for (let i = 0; i < 3; i++) {
    const cur = shown(await plans(driver, s.tenant));
    if (!cur) break;
    if (cur.state === 'planned') return cur;
    await closeTrip(driver, manager, s.tenant, cur.id);
  }
  const left = shown(await plans(driver, s.tenant));
  if (left) throw new Error(`у водителя незавершённая смена ${left.number} (${left.state})`);
  return newTrip(manager, s, { title, driverMemberId: s.members.vasiliev });
}
/**
 * Бронь рейса: `reservationId` рейса (getTripPlan) — и бронь водителя, и бронь назначения логиста (её listReservations
 * не отдаёт) — и её состояние (getReservation).
 */
export async function reservationOf(
  manager: Page,
  tenant: string,
  tripId: string,
): Promise<{ id: string; state: string; etag: string } | undefined> {
  const id = ((await plan(manager, tenant, tripId)).body as { reservationId?: string })
    .reservationId;
  if (!id) return undefined;
  const got = await call(manager, 'GET', `/api/v1/tenants/${tenant}/fleet/reservations/${id}`);
  // Бронь назначения логиста (без водителя) API не отдаёт — 404 (вопрос W2.53).
  if (got.status === 404) return undefined;
  const r = ok(got, 'getReservation');
  return { id, state: (r.body as { state: string }).state, etag: r.headers.etag ?? '' };
}

/** Снять бронь рейса, если она ещё держится (менеджер, releaseReservation) — машина возвращается в пул. */
export async function release(manager: Page, tenant: string, tripId: string): Promise<void> {
  const h = await reservationOf(manager, tenant, tripId);
  if (h?.state !== 'held') return;
  ok(
    await call(manager, 'PATCH', `/api/v1/tenants/${tenant}/fleet/reservations/${h.id}`, {
      body: { action: 'release', reason: 'W2.53: уборка стенд-e2e' },
      ifMatch: h.etag,
    }),
    'releaseReservation',
  );
}
/** Приёмка смены менеджером (reviewTrip approve) — рейс закрыт, машина в пуле, начисление создано. */
export async function approve(manager: Page, tenant: string, tripId: string): Promise<void> {
  const cur = await plan(manager, tenant, tripId);
  ok(
    await call(manager, 'POST', `/api/v1/tenants/${tenant}/fleet/trips/${tripId}/review`, {
      body: { decision: 'approve' },
      ifMatch: cur.headers.etag ?? '',
    }),
    'reviewTrip approve',
  );
}

/**
 * Хранилище стенда доступно браузеру: билет загрузки к рейсу (purpose expense_receipt) указывает на хост из
 * E2E_ALLOW_HOSTS; билет сразу отменяется (abortUpload) — резерв места освобождается.
 */
export async function storageReachable(
  page: Page,
  tenant: string,
  tripId: string,
  allowHosts: readonly string[],
): Promise<boolean> {
  const t = ok(
    await call(page, 'POST', `/api/v1/tenants/${tenant}/files/uploads`, {
      body: {
        fileName: 'probe.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 1024,
        sha256: '0'.repeat(64),
        purpose: 'expense_receipt',
        owner: { moduleKey: 'fleet', entityType: 'trip', entityId: tripId },
      },
    }),
    'initiateUpload',
  ).body as { uploadId: string; uploadUrl: string };
  await call(page, 'DELETE', `/api/v1/tenants/${tenant}/files/uploads/${t.uploadId}`);
  return allowHosts.includes(new URL(t.uploadUrl).host);
}

/**
 * Готовый файл: настоящий JPEG 640×480 из canvas страницы → initiateUpload → presigned PUT → completeUpload →
 * проверка cmd/worker (`ready`).
 */
export async function readyFile(
  page: Page,
  tenant: string,
  purpose: 'inspection' | 'expense_receipt',
  owner: { entityType: 'reservation' | 'trip'; entityId: string },
): Promise<string> {
  const id = await page.evaluate(
    async ({ tenant, purpose, owner }) => {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 480;
      const g = c.getContext('2d');
      if (!g) throw new Error('canvas: нет 2d-контекста');
      g.fillStyle = '#3b7d6e';
      g.fillRect(0, 0, 640, 480);
      g.fillStyle = '#ffffff';
      g.font = '40px sans-serif';
      g.fillText(`Ортус · ${purpose} · ${Math.random().toString(36).slice(2, 8)}`, 30, 250);
      const blob = await new Promise<Blob>((done, fail) =>
        c.toBlob((b) => (b ? done(b) : fail(new Error('toBlob'))), 'image/jpeg', 0.85),
      );
      const bytes = await blob.arrayBuffer();
      const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const csrf = decodeURIComponent(
        /(?:^|;\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? '',
      );
      const post = async (path: string, body: unknown) => {
        const r = await fetch(path, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrf,
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`${path} ${r.status}: ${await r.text()}`);
        return r.json() as Promise<Record<string, string>>;
      };
      const base = `/api/v1/tenants/${tenant}/files`;
      const t = await post(`${base}/uploads`, {
        fileName: `${purpose}.jpg`,
        contentType: 'image/jpeg',
        sizeBytes: bytes.byteLength,
        sha256: sha,
        purpose,
        owner: { moduleKey: 'fleet', ...owner },
      });
      const put = await fetch(t.uploadUrl ?? '', {
        method: 'PUT',
        headers: { 'Content-Type': t.requiredContentType ?? 'image/jpeg' },
        body: bytes,
      });
      if (!put.ok) throw new Error(`PUT ${put.status}`);
      await post(`${base}/uploads/${t.uploadId}/complete`, { sha256: sha });
      return t.fileId ?? '';
    },
    { tenant, purpose, owner },
  );
  await expect
    .poll(
      async () =>
        (
          (await call(page, 'GET', `/api/v1/tenants/${tenant}/files/${id}`)).body as {
            status?: string;
          }
        )?.status,
      { timeout: 60_000, message: `проверка файла ${id} cmd/worker` },
    )
    .toBe('ready');
  return id;
}

async function inspection(
  driver: Page,
  tenant: string,
  o: {
    kind: 'departure' | 'return';
    vehicleId: string;
    tripId: string;
    reservationId?: string;
    odometerKm: string;
    defect?: boolean;
  },
): Promise<string> {
  const list = ok(
    await call(
      driver,
      'GET',
      `/api/v1/tenants/${tenant}/fleet/inspection-checklist?vehicleId=${o.vehicleId}&kind=${o.kind}`,
    ),
    'getInspectionChecklist',
  ).body as { versionId: string; items: { key: string }[] };
  const owner =
    o.kind === 'departure'
      ? { entityType: 'reservation' as const, entityId: o.reservationId ?? '' }
      : { entityType: 'trip' as const, entityId: o.tripId };
  const files: string[] = [];
  for (let i = 0; i < ROLES.length; i++)
    files.push(await readyFile(driver, tenant, 'inspection', owner));
  const at = iso(Date.now());
  const r = ok(
    await call(driver, 'POST', `/api/v1/tenants/${tenant}/fleet/inspections`, {
      body: {
        checklistVersionId: list.versionId,
        vehicleId: o.vehicleId,
        kind: o.kind,
        ...(o.reservationId ? { reservationId: o.reservationId } : { tripId: o.tripId }),
        odometerKm: o.odometerKm,
        fuelPercent: 50,
        checks: list.items.map((i) => ({ key: i.key, result: 'pass' })),
        photos: ROLES.map((role, i) => ({ role, fileId: files[i], capturedAt: at })),
        capturedAt: at,
        ...(o.defect
          ? { defects: [{ zone: 'Стёкла', description: 'Скол', severity: 'blocking' }] }
          : {}),
      },
    }),
    `submitInspection ${o.kind}`,
  );
  return (r.body as { id: string }).id;
}

const etagOf = async (page: Page, tenant: string, tripId: string): Promise<string> =>
  (await plan(page, tenant, tripId)).headers.etag ?? '';

export interface ApiShift {
  reservationId: string;
  vehicle: Vehicle;
  departureInspectionId: string;
}

/** Бронь ГАЗели водителем и осмотр перед выездом с пятью фото; `defect` — блокирующий «Стёкла: Скол». */
export async function apiDeparture(
  driver: Page,
  tenant: string,
  trip: Plan,
  o: { defect?: boolean } = {},
): Promise<ApiShift> {
  const v = await vehicle(driver, tenant);
  const res = ok(
    await call(driver, 'POST', `/api/v1/tenants/${tenant}/fleet/reservations`, {
      body: {
        vehicleId: v.id,
        driverMemberId: trip.driverMemberId,
        window: trip.plannedWindow,
        tripId: trip.id,
      },
    }),
    'reserveVehicle',
  ).body as { id: string };
  const dep = await inspection(driver, tenant, {
    kind: 'departure',
    vehicleId: v.id,
    tripId: trip.id,
    reservationId: res.id,
    odometerKm: String(Number(v.odometerKm) + 130),
    defect: o.defect,
  });
  return { reservationId: res.id, vehicle: v, departureInspectionId: dep };
}

/** Выезд после осмотра (startTrip). */
export async function apiStart(driver: Page, tenant: string, sh: ApiShift): Promise<void> {
  ok(
    await call(driver, 'POST', `/api/v1/tenants/${tenant}/fleet/trips`, {
      body: { reservationId: sh.reservationId, departureInspectionId: sh.departureInspectionId },
    }),
    'startTrip',
  );
}

/** «Завершить рейс» (finishTripRoute), осмотр при сдаче с пятью фото и сдача (returnTrip) → `submitted`. */
export async function apiReturn(
  driver: Page,
  tenant: string,
  trip: Plan,
  sh: ApiShift,
  o: { finish?: boolean } = {},
): Promise<void> {
  if (o.finish !== false) {
    ok(
      await call(
        driver,
        'POST',
        `/api/v1/tenants/${tenant}/fleet/trips/${trip.id}/route-completion`,
        {
          ifMatch: await etagOf(driver, tenant, trip.id),
        },
      ),
      'finishTripRoute',
    );
  }
  const ret = await inspection(driver, tenant, {
    kind: 'return',
    vehicleId: sh.vehicle.id,
    tripId: trip.id,
    odometerKm: String(Number(sh.vehicle.odometerKm) + 190),
  });
  ok(
    await call(driver, 'PATCH', `/api/v1/tenants/${tenant}/fleet/trips/${trip.id}`, {
      body: { action: 'return', returnInspectionId: ret },
      ifMatch: await etagOf(driver, tenant, trip.id),
    }),
    'returnTrip',
  );
}

/** Смена через API целиком до сдачи: бронь, осмотр, выезд, завершение, осмотр при сдаче, сдача. */
export async function apiShift(driver: Page, tenant: string, trip: Plan): Promise<ApiShift> {
  const sh = await apiDeparture(driver, tenant, trip);
  await apiStart(driver, tenant, sh);
  await apiReturn(driver, tenant, trip, sh);
  return sh;
}

/** Настоящий JPEG 640×480 из canvas страницы: на стенде файл проходит сжатие на клиенте (W2.22), MinIO и cmd/worker. */
export async function jpeg(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 480;
    const g = c.getContext('2d');
    if (!g) return '';
    g.fillStyle = '#3b7d6e';
    g.fillRect(0, 0, 640, 480);
    g.fillStyle = '#ffffff';
    g.font = '40px sans-serif';
    g.fillText('Ортус · осмотр', 40, 250);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1] ?? '';
  });
  if (!b64) throw new Error('canvas: нет 2d-контекста');
  return Buffer.from(b64, 'base64');
}

/** Фото слота через выбор файла (камера телефона — тот же input `capture`). */
export async function shoot(page: Page, slot: Locator, file: Buffer, name: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await slot.click();
  await (await chooser).setFiles({ name, mimeType: 'image/jpeg', buffer: file });
}

/**
 * Уборка смены строки, в каком бы состоянии её ни оставила упавшая проверка: не начатая — бронь снимается (дефект на
 * проверке — сначала «разрешить выезд»), начатая — завершается, сдаётся (осмотр с пятью фото) и принимается. Иначе
 * «Логистика» при отключении уходит в `draining`, а водитель следующего проекта видит чужую смену.
 */
export async function closeTrip(
  driver: Page,
  manager: Page,
  tenant: string,
  tripId: string,
): Promise<void> {
  for (let step = 0; step < 6; step++) {
    const p = (await plan(manager, tenant, tripId)).body as Plan;
    switch (p.state) {
      case 'defect_review': {
        const r = ok(
          await call(manager, 'GET', `/api/v1/tenants/${tenant}/fleet/defects?state=in_review`),
          'listInspectionDefects',
        );
        for (const d of (r.body as { items: { id: string; tripId?: string }[] }).items) {
          if (d.tripId !== tripId) continue;
          ok(
            await call(
              manager,
              'POST',
              `/api/v1/tenants/${tenant}/fleet/defects/${d.id}/decision`,
              {
                body: { decision: 'allow_departure', comment: 'W2.53: уборка стенд-e2e' },
              },
            ),
            'decideInspectionDefect',
          );
        }
        break;
      }
      case 'planned':
      case 'assigned':
      case 'inspection':
        await release(manager, tenant, tripId);
        return;
      case 'on_route':
        ok(
          await call(
            driver,
            'POST',
            `/api/v1/tenants/${tenant}/fleet/trips/${tripId}/route-completion`,
            {
              ifMatch: await etagOf(driver, tenant, tripId),
            },
          ),
          'finishTripRoute',
        );
        break;
      case 'returning':
      case 'rework': {
        const v = (await vehicles(manager, tenant)).find((x) => x.id === p.vehicleId);
        if (!v) throw new Error(`нет машины рейса ${p.number}`);
        await apiReturn(
          driver,
          tenant,
          p,
          {
            reservationId: '',
            vehicle: { ...v, odometerKm: String(Number(v.odometerKm) + 10) },
            departureInspectionId: '',
          },
          { finish: false },
        );
        break;
      }
      case 'submitted':
        await approve(manager, tenant, tripId);
        break;
      default:
        return;
    }
  }
}
