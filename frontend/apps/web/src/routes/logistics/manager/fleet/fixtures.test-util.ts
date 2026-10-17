// W2.20 · Данные модельных тестов рабочего места: ответы сценарного сервера W0.13/W2.00 на сиде «Альты» (пресет
// logistics-ready) — те же тела контракта, что получает экран (без ручных копий DTO).
import type { components } from '@ortus/api-client';
import { createScenarioServer, headerCookies } from '@ortus/adapter/msw';
import { seedUuid } from '@ortus/domain/seed';

type S = components['schemas'];

export const ALTA = seedUuid('platform', 't-alta');
export const A = (id: string): string => seedUuid('t-alta', id);

export interface FleetData {
  vehicles: S['Vehicle'][];
  trips: S['TripPlan'][];
  units: S['OrgUnit'][];
  members: S['Member'][];
}

/** Списки «Альты» глазами персонажа `persona` (владелец видит всю организацию, логист — «Север Логистик»). */
export async function fleetData(persona: 'owner' | 'manager' = 'owner'): Promise<FleetData> {
  const srv = createScenarioServer({ cookies: headerCookies });
  srv.applyPreset('logistics-ready');
  const origin = 'http://ortus.test';
  const login = await srv.handle(
    new Request(`${origin}/api/v1/dev/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona }),
    }),
  );
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const get = async <T>(path: string): Promise<T> => {
    const r = await srv.handle(
      new Request(`${origin}/api/v1/tenants/${ALTA}/${path}`, { headers: { cookie } }),
    );
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return ((await r.json()) as { items: T }).items;
  };
  return {
    vehicles: await get<S['Vehicle'][]>('fleet/vehicles?limit=200'),
    trips: await get<S['TripPlan'][]>('fleet/trip-plans?limit=200'),
    units: await get<S['OrgUnit'][]>('org-units?limit=200'),
    members: await get<S['Member'][]>('members?limit=200'),
  };
}
