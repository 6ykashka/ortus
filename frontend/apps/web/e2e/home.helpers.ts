// W2.25 · Помощники e2e «Главной»: вход персонажа и «Главная» своей организации, очередь «Требует решения»,
// правка логистики сценарного сервера вкладки (только mock): блокирующий дефект, смена на приёмке, рейсы без
// водителя — init-скриптом до старта MSW, как inbox.spec.ts (состояние живёт в sessionStorage).
import type { Persona } from '@ortus/e2e-kit';
import type { Locator, Page } from '@playwright/test';

import { MOCK_STATE_KEY } from './auth.helpers.ts';
import { openPage } from './modules.helpers.ts';
import { call } from './shell.helpers.ts';

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<unknown>;

/** `h1` «Главной» — приветствие по часам (:4127); до W2.25 заглушка оболочки писала «Главная». */
export const HOME_H1 = /^(Доброе утро|Добрый день|Добрый вечер), /;

/** «Главная» организации по прямому URL; возвращает id организации. */
export async function openHome(
  app: AppFn,
  page: Page,
  o: { persona?: Persona; tenant?: string; preset?: string } = {},
): Promise<string> {
  const id = await openPage(app, page, 'home', o);
  await page.locator('section[aria-labelledby="h-home"]').waitFor();
  return id;
}

/** Область очереди «Требует решения». */
export const queue = (page: Page): Locator =>
  page.getByRole('region', { name: 'Требует решения', exact: true });

/** Карточки очереди в порядке показа. */
export const cards = (page: Page): Locator => queue(page).getByRole('listitem');

/** Карточка очереди по заголовку. */
export const card = (page: Page, title: string | RegExp): Locator =>
  cards(page).filter({ has: page.locator('strong', { hasText: title }) });

/** Заголовки карточек очереди. */
export async function cardTitles(page: Page): Promise<string[]> {
  return cards(page).locator('strong').allInnerTexts();
}

export type FleetPatch = 'defect' | 'submitted' | 'many-without-driver';

interface TripLike {
  id: string;
  number: string;
  state: string;
  orgUnitId: string;
  driverMemberId?: string;
  driverDisplayName?: string;
  returnedAt?: string;
  [k: string]: unknown;
}

/**
 * Правка логистики «Альты» в состоянии вкладки на следующей загрузке (до старта MSW): `defect` — Р-208
 * «Дефект на проверке» с критическим «Стёкла: Скол» (как conformance `departure(…, true)`), `submitted` — сданная
 * смена Р-205 Ильи Васильева, `many-without-driver` — ещё 9 рейсов без водителя. Нужна загруженная «Главная»
 * логиста с подключённой «Логистикой» (данные логистики уже в состоянии).
 */
export async function patchFleet(
  page: Page,
  tenant: string,
  patches: readonly FleetPatch[],
): Promise<void> {
  await page.addInitScript(
    ({ key, alta, patches }) => {
      const done = `e2e:home:${patches.join(',')}`;
      const raw = sessionStorage.getItem(key);
      if (sessionStorage.getItem(done) || !raw) return;
      const s = JSON.parse(raw) as {
        orgs: Record<
          string,
          {
            fleet?: {
              trips: TripLike[];
              vehicles: { id: string; orgUnitId: string }[];
              defects: Record<string, unknown>[];
            };
          }
        >;
      };
      const fleet = s.orgs[alta]?.fleet;
      if (!fleet) return;
      const base = fleet.trips.find((t) => t.number === 'Р-208');
      const free = fleet.trips.find((t) => t.number === 'Р-211');
      if (!base || !free) return;
      const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
      if (patches.includes('defect')) {
        const v = fleet.vehicles.find((x) => x.orgUnitId === base.orgUnitId);
        const id = uuid(900001);
        base.state = 'defect_review';
        base.blockingDefectId = id;
        if (v) base.vehicleId = v.id;
        fleet.defects.push({
          id,
          vehicleId: v?.id ?? '',
          inspectionId: uuid(900002),
          tripId: base.id,
          zone: 'Стёкла',
          description: 'Скол',
          severity: 'blocking',
          state: 'in_review',
          reportedAt: '2026-10-01T07:20:00Z',
          reportedByMemberId: base.driverMemberId ?? '',
          revision: 1,
        });
      }
      if (patches.includes('submitted')) {
        fleet.trips.push({
          ...base,
          id: uuid(900003),
          number: 'Р-205',
          state: 'submitted',
          returnedAt: '2026-10-01T07:00:00Z',
          blockingDefectId: undefined,
        });
      }
      if (patches.includes('many-without-driver')) {
        for (let i = 1; i <= 9; i += 1) {
          fleet.trips.push({ ...free, id: uuid(900100 + i), number: `Р-30${i}` });
        }
      }
      sessionStorage.setItem(key, JSON.stringify(s));
      sessionStorage.setItem(done, '1');
    },
    { key: MOCK_STATE_KEY, alta: tenant, patches: [...patches] },
  );
}

/** Рейсы организации (id по номеру) — для проверки адреса перехода `?trip=`. */
export async function tripIds(page: Page, tenant: string): Promise<Record<string, string>> {
  const r = await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/trip-plans?limit=100`);
  const items = (r.body as { items?: { id: string; number: string }[] }).items ?? [];
  return Object.fromEntries(items.map((t) => [t.number, t.id]));
}
