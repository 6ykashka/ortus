// W2.23 · Помощники e2e «Ресурсного пула» (`logistics-pool`) и диалога «Запросить водителя» (`modal-driver-request`):
// вход персонажа на «Альту» с пресетом `logistics-ready` (Котова — «Менеджер логистики» «Север Логистик», пул сида —
// Водитель #104 «Юг Транс» 13:00–19:00 и #117 «Восток Карго» 15:00–20:00, Р-211 без водителя 14:00–18:00), локаторы
// карточек и блока входящих, запрос и решение через API из сессии страницы (подготовка состояний).
import type { Persona } from '@ortus/e2e-kit';
import type { Locator, Page } from '@playwright/test';

import { call, devScenario, type Reply, tenantId } from './shell.helpers.ts';

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<unknown>;

export const POOL_H1 = 'Ресурсный пул';
export const POOL_INTRO =
  'Свободные водители других фирм группы. Показан минимум сведений, разрешённый владеющей фирмой. Запрос не даёт доступа до одобрения.';
export const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';

export const phone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 640;

/** Пресет `logistics-ready` (владелец), затем `route` «Альты» персонажем (по умолчанию — пул логиста). */
export async function openPool(
  app: AppFn,
  page: Page,
  o: { persona?: Persona; route?: string; preset?: string } = {},
): Promise<string> {
  await app('/', { persona: 'owner' });
  const alta = await tenantId(page);
  await devScenario(page, { preset: o.preset ?? 'logistics-ready' });
  await app(`/t/${alta}/${o.route ?? 'pool'}`, { persona: o.persona ?? 'manager' });
  return alta;
}

export const pool = (page: Page): Locator => page.locator('section[aria-labelledby="h-pool"]');

/** Карточка водителя пула по псевдониму. */
export const driverCard = (page: Page, code: string): Locator =>
  page
    .locator('article.ox-pl-driver')
    .filter({ has: page.locator('.ox-pl-code', { hasText: new RegExp(`^${code}$`) }) });

/** Значение строки `<dl>` карточки по термину. */
export const cardValue = (card: Locator, term: string): Locator =>
  card
    .locator('dt', { hasText: new RegExp(`^${term}$`) })
    .locator('xpath=following-sibling::dd[1]');

export const incoming = (page: Page): Locator =>
  page.locator('section[aria-labelledby="h-pool-in"]');

export const incomingCard = (page: Page, code: string): Locator =>
  incoming(page).locator('article').filter({ hasText: code });

interface Plan {
  id: string;
  number: string;
  orgUnitId: string;
  plannedWindow: { startsAt: string; endsAt: string; timeZone: string };
}

interface Availability {
  driverMemberId: string;
  displayName: string;
  homeOrgUnitId: string;
  publicationId?: string;
  freeWindow: { startsAt: string; endsAt: string; timeZone: string };
}

const ok = (r: Reply, what: string): Reply => {
  if (r.status >= 300) throw new Error(`${what} ${r.status}: ${JSON.stringify(r.body)}`);
  return r;
};

export async function tripByNumber(page: Page, tenant: string, number = 'Р-211'): Promise<Plan> {
  const r = ok(
    await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/trip-plans?limit=200`),
    'listTripPlans',
  );
  const t = (r.body as { items: Plan[] }).items.find((x) => x.number === number);
  if (!t) throw new Error(`нет рейса ${number}`);
  return t;
}

/** «Запросить на рейс Р-211» через API из сессии страницы (окно — пересечение окна рейса и свободного окна). */
export async function apiRequest(
  page: Page,
  tenant: string,
  code = 'Водитель #104',
  trip = 'Р-211',
): Promise<{ id: string; revision: number }> {
  const t = await tripByNumber(page, tenant, trip);
  const q = `availableFrom=${t.plannedWindow.startsAt}&availableUntil=${t.plannedWindow.endsAt}`;
  const cat = ok(
    await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/driver-pool?${q}`),
    'listAvailableDrivers',
  );
  const d = (cat.body as { items: Availability[] }).items.find((x) => x.displayName === code);
  if (!d) throw new Error(`нет «${code}» в каталоге`);
  const max = (a: string, b: string) => (Date.parse(a) > Date.parse(b) ? a : b);
  const min = (a: string, b: string) => (Date.parse(a) < Date.parse(b) ? a : b);
  const r = ok(
    await call(page, 'POST', `/api/v1/tenants/${tenant}/fleet/driver-transfer-requests`, {
      body: {
        driverMemberId: d.driverMemberId,
        sourceOrgUnitId: d.homeOrgUnitId,
        targetOrgUnitId: t.orgUnitId,
        window: {
          startsAt: max(t.plannedWindow.startsAt, d.freeWindow.startsAt),
          endsAt: min(t.plannedWindow.endsAt, d.freeWindow.endsAt),
          timeZone: t.plannedWindow.timeZone,
        },
        reason: `Запрос на рейс ${trip}`,
        tripId: t.id,
        ...(d.publicationId ? { publicationId: d.publicationId } : {}),
      },
    }),
    'requestDriverTransfer',
  );
  return r.body as { id: string; revision: number };
}

/** Решение фирмы-источника через API (владелец или менеджер фирмы-источника; If-Match свежего GET). */
export async function apiDecide(
  page: Page,
  tenant: string,
  id: string,
  decision: 'approve' | 'reject' | 'revoke',
): Promise<Reply> {
  const path = `/api/v1/tenants/${tenant}/fleet/driver-transfer-requests/${id}`;
  const cur = ok(await call(page, 'GET', path), 'getDriverTransfer');
  return ok(
    await call(page, 'POST', `${path}/decision`, {
      // W2.71 (0.6.3-stage2, S2-20; Q-W2.70-8): «Отклонить» — только с причиной.
      body:
        decision === 'reject'
          ? { decision, comment: 'Водитель нужен на своём рейсе' }
          : { decision },
      ifMatch: cur.headers.etag ?? '',
    }),
    `decideDriverTransfer ${decision}`,
  );
}
