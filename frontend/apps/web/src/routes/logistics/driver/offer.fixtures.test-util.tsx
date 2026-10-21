// W2.74 · Экранные тесты машин на выбор (S2-20): приложение на MSW-сценарном сервере, как renderMockApp
// (app/testing.tsx), но перед рендером владелец готовит сюжет командами API — как conformance W2.71
// `cases/vehicle-offer.ts`: Тимур Ахмедов («Север Логистик», роль «Водитель» своей фирмы — с fleet.reservations.choose,
// Q-W2.70-7) в пуле с обычной машиной Mercedes Sprinter, рейс «Юг Транс» 14:00–18:00, запрос с машиной Isuzu Elf,
// одобрение — брони предложения. Затем вход Ахмедовым (acc-9) и «Моя смена». Прямой мок fetch не используется.
import { createApiClient, devLogin } from '@ortus/api-client';
import type { CookieJar } from '@ortus/adapter/msw';
import { createNodeServer } from '@ortus/adapter/msw/node';
import { seedUuid } from '@ortus/domain/seed';
import { render } from '@testing-library/react';

import { App } from '../../../app/App.tsx';
import { createAppRouter } from '../../../app/router.tsx';
import { BASE_URL, type MockApp, type SeenResponse } from '../../../app/testing.tsx';

export const ALTA = seedUuid('platform', 't-alta');
const A = (id: string) => seedUuid('t-alta', id);
const T = `/api/v1/tenants/${ALTA}`;

const MSK = 'Europe/Moscow';
export const W = {
  startsAt: '2026-10-01T11:00:00Z',
  endsAt: '2026-10-01T15:00:00Z',
  timeZone: MSK,
};
/** Срок выбора прошёл (13:31 по Москве). */
export const AFTER_DEADLINE = '2026-10-01T10:31:00Z';
/** В окне рейса (14:05 по Москве). */
export const IN_WINDOW = '2026-10-01T11:05:00Z';

export type OfferMode = 'two' | 'one' | 'none';

export interface OfferApp extends MockApp {
  tripId: string;
  tripNumber: string;
}

function memoryJar(): { jar: CookieJar; get: (name: string) => string | undefined } {
  const store = new Map<string, string>();
  return {
    jar: {
      read: () => Object.fromEntries(store),
      write: (_headers, cookies) => {
        for (const c of cookies) {
          if (c.maxAge === 0) store.delete(c.name);
          else store.set(c.name, c.value);
        }
      },
    },
    get: (name) => store.get(name),
  };
}

/**
 * Сюжет `mode` и «Моя смена» Ахмедова (или `route`): `two` — «Ставим нашу машину» Isuzu Elf + «Можно взять свою
 * обычную» (две брони до 13:30); `one` — только Isuzu Elf (бронь сразу confirmed); `none` — «Едет на своей обычной»,
 * одобрено «Только водителя» (броней нет). `now` — часы сервера после одобрения; `scenario` — сбой операций экрана.
 */
export async function renderOffer(
  mode: OfferMode,
  o: { route?: 'today' | 'cars'; now?: string; scenario?: string } = {},
): Promise<OfferApp> {
  const { jar, get } = memoryJar();
  const { server, scenario } = createNodeServer({ cookies: jar });
  server.listen({ onUnhandledRequest: 'error' });
  scenario.applyPreset('logistics-ready');
  await devLogin('owner', { baseUrl: BASE_URL });
  const call = async (
    method: string,
    path: string,
    x: { body?: unknown; ifMatch?: string } = {},
  ): Promise<{ status: number; body: Record<string, unknown>; etag: string }> => {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: BASE_URL,
        'X-CSRF-Token': get('ortus_csrf') ?? '',
        ...(method === 'GET' ? {} : { 'Idempotency-Key': crypto.randomUUID() }),
        ...(x.ifMatch ? { 'If-Match': x.ifMatch } : {}),
      },
      ...(x.body === undefined ? {} : { body: JSON.stringify(x.body) }),
    });
    const body = (res.status === 204 ? {} : await res.json()) as Record<string, unknown>;
    if (res.status >= 300)
      throw new Error(`${method} ${path} ${res.status}: ${JSON.stringify(body)}`);
    return { status: res.status, body, etag: res.headers.get('ETag') ?? '' };
  };
  const akh = A('m-akhmedov');
  const sever = A('f-msk-sever');
  const yug = A('f-msk-yug');
  const member = await call('GET', `${T}/members/${akh}`);
  await call('PATCH', `${T}/members/${akh}`, {
    body: { orgUnitIds: [sever] },
    ifMatch: member.etag,
  });
  await call('POST', `${T}/assignments`, {
    body: {
      principalType: 'member',
      principalId: akh,
      roleId: A('r-driver'),
      scope: { kind: 'org_unit', resourceIds: [sever], includeDescendants: true },
    },
  });
  const pub = await call('POST', `${T}/fleet/driver-pool/publications`, {
    body: {
      driverMemberId: akh,
      homeOrgUnitId: sever,
      freeWindow: W,
      qualifications: ['Кат. B'],
      terms: 'По соглашению фирм группы',
      usualVehicleId: A('v6'),
    },
  });
  const trip = await call('POST', `${T}/fleet/trip-plans`, {
    body: {
      orgUnitId: yug,
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
          plannedAt: W.startsAt,
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
    },
  });
  const tripId = String(trip.body.id);
  const vehicle =
    mode === 'two'
      ? { mode: 'host_or_home', hostVehicleId: A('v5') }
      : mode === 'one'
        ? { mode: 'host', hostVehicleId: A('v5') }
        : { mode: 'home' };
  const req = await call('POST', `${T}/fleet/driver-transfer-requests`, {
    body: {
      driverMemberId: akh,
      sourceOrgUnitId: sever,
      targetOrgUnitId: yug,
      window: W,
      reason: `Запрос на рейс ${String(trip.body.number)}`,
      tripId,
      publicationId: pub.body.id,
      vehicle,
    },
  });
  const path = `${T}/fleet/driver-transfer-requests/${String(req.body.id)}`;
  const cur = await call('GET', path);
  await call('POST', `${path}/decision`, {
    body: { decision: mode === 'none' ? 'approve_driver_only' : 'approve' },
    ifMatch: cur.etag,
  });
  if (o.now) scenario.setNow(o.now);
  await devLogin('acc-9', { baseUrl: BASE_URL });
  // Сценарий сбоя (`listReservations=rate_limited` …) — после подготовки сюжета, до первого запроса экрана.
  if (o.scenario) scenario.setScenario(o.scenario);
  const api = createApiClient({ baseUrl: BASE_URL, csrfToken: () => get('ortus_csrf') });
  const seen: SeenResponse[] = [];
  server.events.on('response:mocked', ({ request, response }) => {
    seen.push({
      method: request.method,
      path: new URL(request.url).pathname,
      status: response.status,
    });
  });
  const router = createAppRouter(`/t/${ALTA}/${o.route ?? 'today'}`);
  const view = render(<App api={api} router={router} realtime={null} />);
  return {
    ...view,
    router,
    scenario,
    tripId,
    tripNumber: String(trip.body.number),
    path: () => router.state.location.pathname,
    responses: () => seen,
    close: () => {
      view.unmount();
      server.close();
    },
  };
}
