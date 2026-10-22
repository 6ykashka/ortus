// W2.73 · Помощники e2e S2-20 «Машина для временного водителя» (D-35; «Временный водитель - варианты.dc.html»,
// design-2026-10-19b), только режим mock. В сиде 14.10 у водителей пула нет обычной машины (Q-W2.71-6), поэтому
// правка состояния сценарного сервера вкладки (init-скрипт до старта MSW, как home.helpers.ts `patchFleet`) даёт
// Водителю #104 «Юг Транс» имя Олег Тарасов (карточка участника, как на макете) и обычную машину Hyundai HD-35
// «Н 384 ТК 77» (cars.home :504; `fits=false` — фургон без охлаждения, tweak homeCarFits). Запрос и решение —
// через API из сессии страницы (владелец), часы сервера — `dev/scenario` `now`.
import type { Locator, Page } from '@playwright/test';

import { MOCK_STATE_KEY } from './auth.helpers.ts';
import { tripByNumber } from './logistics-pool.helpers.ts';
import { call, type Reply } from './shell.helpers.ts';

export const HD = 'Hyundai HD-35';
export const HD_PLATE = 'Н 384 ТК 77';
export const DRIVER = 'Олег Тарасов';

/** Правка состояния «Альты» на следующей загрузке: имя и обычная машина Водителя #104 (данные пула уже в состоянии). */
export async function patchUsual(page: Page, tenant: string, fits = true): Promise<void> {
  await page.addInitScript(
    ({ key, alta, fits, name, model, plate }) => {
      const done = `e2e:s220:${fits ? 'fits' : 'unfit'}`;
      const raw = sessionStorage.getItem(key);
      if (sessionStorage.getItem(done) || !raw) return;
      const s = JSON.parse(raw) as {
        orgs: Record<
          string,
          {
            members?: Record<string, unknown>[];
            fleet?: {
              pool: {
                displayName: string;
                driverMemberId: string;
                homeOrgUnitId: string;
                driverDisplayName?: string;
                usualVehicleId?: string;
              }[];
              vehicles: Record<string, unknown>[];
            };
          }
        >;
      };
      const org = s.orgs[alta];
      const pub = org?.fleet?.pool.find((p) => p.displayName === 'Водитель #104');
      if (!org?.fleet || !pub) return;
      const id = '00000000-0000-4000-8000-000000920001';
      org.fleet.vehicles.push({
        id,
        proto: 'v-hd35',
        orgUnitId: pub.homeOrgUnitId,
        registrationNumber: plate,
        displayName: model,
        bodyType: fits ? 'refrigerated' : 'van',
        capacity: {
          payloadKg: '1800',
          volumeM3: '13',
          cargoLengthM: '3.6',
          cargoWidthM: '2',
          cargoHeightM: '1.9',
        },
        ...(fits ? { temperatureMinC: '-10', temperatureMaxC: '10' } : {}),
        equipment: fits ? ['refrigerator'] : [],
        odometerKm: '84912',
        depot: 'Стоянка Юг Транс, Варшавское ш.',
        vstate: 'free',
        revision: 1,
      });
      pub.usualVehicleId = id;
      pub.driverDisplayName = name;
      org.members?.push({
        id: pub.driverMemberId,
        proto: 'm-tarasov',
        displayName: name,
        status: 'active',
        orgUnitIds: [pub.homeOrgUnitId],
        revision: 1,
        workProfiles: ['driver'],
      });
      sessionStorage.setItem(key, JSON.stringify(s));
      sessionStorage.setItem(done, '1');
    },
    { key: MOCK_STATE_KEY, alta: tenant, fits, name: DRIVER, model: HD, plate: HD_PLATE },
  );
}

/**
 * Итог выбора водителя в состоянии сервера сценариев на следующей загрузке (экран выбора — W2.74; персонажа
 * временного водителя #104 в mock нет): бронь обычной машины — confirmed в `at`, бронь машины фирмы рейса — released
 * с причиной chosen (как chooseReservation MSW W2.71).
 */
export async function patchChosen(page: Page, tenant: string, at: string): Promise<void> {
  await page.addInitScript(
    ({ key, alta, at }) => {
      const done = 'e2e:s220:chosen';
      const raw = sessionStorage.getItem(key);
      if (sessionStorage.getItem(done) || !raw) return;
      const s = JSON.parse(raw) as {
        orgs: Record<
          string,
          {
            fleet?: {
              reservations: {
                state: string;
                offerKind?: string;
                offerGroupId?: string;
                chosenAt?: string;
                releasedAt?: string;
                releaseReason?: string;
                holdExpiresAt: string;
                window: { endsAt: string };
                revision: number;
              }[];
            };
          }
        >;
      };
      const list = s.orgs[alta]?.fleet?.reservations ?? [];
      const usual = list.find((r) => r.offerKind === 'usual' && r.state === 'held');
      const host = list.find(
        (r) =>
          r.offerKind === 'host' && r.state === 'held' && r.offerGroupId === usual?.offerGroupId,
      );
      if (!usual || !host) return;
      Object.assign(usual, {
        state: 'confirmed',
        chosenAt: at,
        holdExpiresAt: usual.window.endsAt,
        revision: usual.revision + 1,
      });
      Object.assign(host, {
        state: 'released',
        releasedAt: at,
        releaseReason: 'chosen',
        revision: host.revision + 1,
      });
      sessionStorage.setItem(key, JSON.stringify(s));
      sessionStorage.setItem(done, '1');
    },
    { key: MOCK_STATE_KEY, alta: tenant, at },
  );
}

const ok = (r: Reply, what: string): Reply => {
  if (r.status >= 300) throw new Error(`${what} ${r.status}: ${JSON.stringify(r.body)}`);
  return r;
};

interface VehicleLike {
  id: string;
  registrationNumber: string;
}

/** Id машины по госномеру (listVehicles смотрящего). */
export async function vehicleId(page: Page, tenant: string, plate: string): Promise<string> {
  const r = ok(
    await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/vehicles?limit=200`),
    'listVehicles',
  );
  const v = (r.body as { items: VehicleLike[] }).items.find((x) => x.registrationNumber === plate);
  if (!v) throw new Error(`нет машины ${plate}`);
  return v.id;
}

/**
 * «Запросить на рейс Р-211» Водителя #104 с машиной через API (окно — пересечение с 13:00–19:00 = окно рейса):
 * `host_or_home` — «Наша + можно свою» (Ford Transit), `host` — «Только наша», `home` — «Своя машина водителя».
 */
export async function apiRequestVehicle(
  page: Page,
  tenant: string,
  mode: 'host_or_home' | 'host' | 'home' = 'host_or_home',
): Promise<{ id: string }> {
  const t = await tripByNumber(page, tenant);
  const q = `availableFrom=${t.plannedWindow.startsAt}&availableUntil=${t.plannedWindow.endsAt}`;
  const cat = ok(
    await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/driver-pool?${q}`),
    'listAvailableDrivers',
  ).body as {
    items: {
      displayName: string;
      driverMemberId: string;
      homeOrgUnitId: string;
      publicationId?: string;
    }[];
  };
  const d = cat.items.find((x) => x.displayName === 'Водитель #104');
  if (!d) throw new Error('нет Водителя #104 в каталоге');
  const host = mode === 'home' ? undefined : await vehicleId(page, tenant, 'М 608 КТ 77');
  const r = ok(
    await call(page, 'POST', `/api/v1/tenants/${tenant}/fleet/driver-transfer-requests`, {
      body: {
        driverMemberId: d.driverMemberId,
        sourceOrgUnitId: d.homeOrgUnitId,
        targetOrgUnitId: t.orgUnitId,
        window: t.plannedWindow,
        reason: 'Запрос на рейс Р-211',
        tripId: t.id,
        ...(d.publicationId ? { publicationId: d.publicationId } : {}),
        vehicle: { mode, ...(host ? { hostVehicleId: host } : {}) },
      },
    }),
    'requestDriverTransfer',
  );
  return r.body as { id: string };
}

/** Решение фирмы водителя через API (владелец; If-Match свежего GET). */
export async function apiDecideVehicle(
  page: Page,
  tenant: string,
  id: string,
  decision: 'approve' | 'approve_driver_only',
): Promise<void> {
  const path = `/api/v1/tenants/${tenant}/fleet/driver-transfer-requests/${id}`;
  const cur = ok(await call(page, 'GET', path), 'getDriverTransfer');
  ok(
    await call(page, 'POST', `${path}/decision`, {
      body: { decision },
      ifMatch: cur.headers.etag ?? '',
    }),
    `decideDriverTransfer ${decision}`,
  );
}

/** Часы сценарного сервера (dev/scenario `now`): «13:20» по Москве — за 10 минут до срока выбора 13:30. */
export async function serverClock(page: Page, now: string): Promise<void> {
  const r = await call(page, 'POST', '/api/v1/dev/scenario', { body: { now } });
  if (r.status !== 200) throw new Error(`dev/scenario ${r.status}: ${JSON.stringify(r.body)}`);
}

/** Строки «Машины рейса» карточки перевода (имя · номер, фирма, чип). */
export const tripCars = (card: Locator): Locator => card.locator('.ox-pl-trip-car');

/** Строки «Журнала» карточки перевода: «ЧЧ:ММ текст». */
export async function journal(card: Locator): Promise<string[]> {
  return card
    .locator('.ox-pl-journal li')
    .evaluateAll((els) =>
      els.map((li) => Array.from(li.children, (c) => c.textContent ?? '').join(' ')),
    );
}

/**
 * Число строк текста элемента: прямоугольники текста по вертикали, перекрывающиеся — одна строка (моноширинный
 * номер другого кегля стоит в той же строке выше или ниже на пиксель).
 */
export async function textLines(l: Locator): Promise<number> {
  return l.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const rects = [...r.getClientRects()].filter((x) => x.width > 0).sort((a, b) => a.top - b.top);
    let lines = 0;
    let bottom = -Infinity;
    for (const x of rects) {
      if (x.top >= bottom - 1) {
        lines += 1;
        bottom = x.bottom;
      } else bottom = Math.max(bottom, x.bottom);
    }
    return lines;
  });
}
