// W2.73 · Помощники строк @stand S2-20 «Машина для временного водителя» (D-35; «Временный водитель - варианты.dc.html»,
// design-2026-10-19b) на контракте 0.6.3-stage2. Сида пула на стенде нет (Q-W2.07-5), обычных машин у водителей — тоже
// (Q-W2.71-6): строка сама готовит пул через poolStand (`foreign` — водитель «Юг Транс», рейс «Север Логистик» логиста
// Котовой) и обычную машину водителя — Hyundai HD-35 «Юг Транс» (createVehicle владельца, одна на проект: повторный
// прогон берёт её же; стенд пересоздаётся `down -v`). Уборка — poolStand: открытые запросы отклоняются, одобренные
// отзываются (брони предложения освобождаются вместе с переводом), публикация снимается.
import type { Locator, Page } from '@playwright/test';

import type { Session, Undo } from './_stand/fixtures.ts';
import { driverCard } from './logistics-pool.helpers.ts';
import { type PoolStand, poolStand } from './logistics-pool.stand.ts';
import { call, type Reply } from './shell.helpers.ts';

/** Модель обычной машины (макет 1a, cars.home :504). */
export const USUAL = 'Hyundai HD-35';
export const YUG = 'Юг Транс';

export interface S220Stand extends PoolStand {
  /** Обычная машина водителя: id и госномер (свой у каждого проекта). */
  usual: { id: string; plate: string };
}

const ok = (r: Reply, what: string): Reply => {
  if (r.status >= 300) throw new Error(`${what} ${r.status}: ${JSON.stringify(r.body)}`);
  return r;
};

/** Hyundai HD-35 «Юг Транс» проекта (рефрижератор −10…+10 °C, 1,8 т, 13 м³, кузов 3,6 м): найти или создать. */
async function usualVehicle(
  owner: Page,
  tenant: string,
  unit: string,
  project: string,
): Promise<{ id: string; plate: string }> {
  const base = `/api/v1/tenants/${tenant}/fleet/vehicles`;
  const plate = `Н 384 ТК ${project}`;
  const list = ok(await call(owner, 'GET', `${base}?limit=200`), 'listVehicles').body as {
    items: { id: string; registrationNumber: string }[];
  };
  const found = list.items.find((v) => v.registrationNumber === plate);
  if (found) return { id: found.id, plate };
  const created = ok(
    await call(owner, 'POST', base, {
      body: {
        orgUnitId: unit,
        registrationNumber: plate,
        displayName: USUAL,
        bodyType: 'refrigerated',
        capacity: {
          payloadKg: '1800',
          volumeM3: '13',
          cargoLengthM: '3.6',
          cargoWidthM: '2',
          cargoHeightM: '1.9',
        },
        temperatureMinC: '-10',
        temperatureMaxC: '10',
        equipment: ['refrigerator'],
        odometerKm: '84912',
        depot: 'Стоянка Юг Транс, Варшавское ш.',
      },
    }),
    'createVehicle',
  ).body as { id: string };
  return { id: created.id, plate };
}

/** Пул строки S2-20: водитель «Юг Транс» с обычной машиной, рейс «Север Логистик» в окне публикации. */
export async function s220Stand(
  session: () => Promise<Session>,
  undo: Undo,
  project: string,
): Promise<S220Stand> {
  let usual: { id: string; plate: string } | undefined;
  const s = await poolStand(session, undo, project, {
    foreign: true,
    usual: async (owner, tenant, unit) => {
      usual = await usualVehicle(owner, tenant, unit, project);
      return usual.id;
    },
  });
  if (!usual) throw new Error('обычная машина водителя не создана');
  return { ...s, usual };
}

/** «Запросить на рейс {номер}» карточки водителя строки — диалог «Запросить водителя». */
export async function openRequest(page: Page, s: PoolStand): Promise<Locator> {
  await driverCard(page, s.code)
    .getByRole('button', { name: `Запросить на рейс ${s.trip.number}` })
    .click();
  const dlg = page.getByRole('dialog');
  await dlg.waitFor();
  return dlg;
}

/** Модель машины фирмы рейса, выбранной в поле «Ставим нашу машину» («Ford Transit» из «Ford Transit · М 608 КТ 77»). */
export async function hostModel(dlg: Locator): Promise<string> {
  const text = (await dlg.locator('.ox-pl-select-value').innerText()).replace(/\s+/g, ' ').trim();
  const model = text.split(' · ')[0] ?? '';
  if (!model) throw new Error(`в поле «Ставим нашу машину» нет машины: «${text}»`);
  return model;
}

interface PlanLike {
  id: string;
  orgUnitId: string;
  plannedWindow: { startsAt: string; endsAt: string; timeZone: string };
}

/**
 * «Запросить на рейс» водителя строки через API логиста (`page`) с машиной `mode` (только `home`: машину фирмы рейса
 * выбирает диалог, его проверяет строка modal-driver-request). Окно — окно рейса (оно внутри окна публикации).
 */
export async function standRequest(
  page: Page,
  s: PoolStand,
  mode: 'home',
): Promise<{ id: string }> {
  const base = `/api/v1/tenants/${s.tenant}/fleet`;
  const t = ok(await call(page, 'GET', `${base}/trip-plans/${s.trip.id}`), 'getTripPlan')
    .body as PlanLike;
  const q = `availableFrom=${t.plannedWindow.startsAt}&availableUntil=${t.plannedWindow.endsAt}&tripId=${t.id}`;
  const cat = ok(await call(page, 'GET', `${base}/driver-pool?${q}`), 'listAvailableDrivers')
    .body as {
    items: {
      displayName: string;
      driverMemberId: string;
      homeOrgUnitId: string;
      publicationId?: string;
    }[];
  };
  const d = cat.items.find((x) => x.publicationId === s.publicationId);
  if (!d) throw new Error(`нет «${s.code}» в каталоге на рейс ${s.trip.number}`);
  const r = ok(
    await call(page, 'POST', `${base}/driver-transfer-requests`, {
      body: {
        driverMemberId: d.driverMemberId,
        sourceOrgUnitId: d.homeOrgUnitId,
        targetOrgUnitId: t.orgUnitId,
        window: t.plannedWindow,
        reason: `Запрос на рейс ${s.trip.number}`,
        tripId: t.id,
        publicationId: s.publicationId,
        vehicle: { mode },
      },
    }),
    'requestDriverTransfer',
  );
  return r.body as { id: string };
}

/** Строка для RegExp: спецсимволы экранированы. */
export const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface TransferLike {
  id: string;
  status: string;
  publicationId?: string;
  vehicle?: {
    mode: string;
    hostVehicle?: { displayName: string };
    homeVehicle?: { displayName: string };
  };
}

/** Перевод публикации строки (исходящие логиста или входящие владельца). */
export async function transferOf(page: Page, s: PoolStand): Promise<TransferLike | undefined> {
  const r = ok(
    await call(
      page,
      'GET',
      `/api/v1/tenants/${s.tenant}/fleet/driver-transfer-requests?status=requested&status=approved&limit=200`,
    ),
    'listDriverTransfers',
  );
  return (r.body as { items: TransferLike[] }).items.find(
    (x) => x.publicationId === s.publicationId,
  );
}
