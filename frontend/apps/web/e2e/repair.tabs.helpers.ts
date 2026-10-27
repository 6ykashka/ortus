// W6.21 · Помощники e2e вкладок «Замер» и «Смета»: вход персонажа, пресет repairs-ready («сегодня» 20.10.2026), id
// объекта по названию и переход на `repair?obj=&tab=` по прямому URL (хост-заглушка repair.page.tsx, W6.20 заменит).
import type { Persona } from '@ortus/e2e-kit';
import type { Locator, Page } from '@playwright/test';

import { call, devScenario, tenantId } from './shell.helpers.ts';

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<unknown>;

/** Объекты сида «Альты» по названию. */
export const OBJ = {
  kv42: 'ЖК Речной · квартира 42',
  istra: 'Дом 120 м², Истра',
  mytishchi: 'Дом на Лесной · Мытищи',
} as const;

export interface Opened {
  tenant: string;
  project: string;
}

export async function openRepair(
  app: AppFn,
  page: Page,
  o: { obj: string; tab?: 'measure' | 'estimate'; persona?: Persona; scenario?: string },
): Promise<Opened> {
  const persona = o.persona ?? 'owner';
  await app('/', { persona });
  const tenant = await tenantId(page);
  await devScenario(page, { preset: 'repairs-ready' });
  // Пресет сбрасывает сессии сценарного сервера — повторный вход персонажа.
  await app('/', { persona });
  const list = await call(page, 'GET', `/api/v1/tenants/${tenant}/repairs/projects`);
  if (list.status !== 200)
    throw new Error(`listRepairProjects ${list.status}: ${JSON.stringify(list.body)}`);
  const items = (list.body as { items: { id: string; name: string }[] }).items;
  const found = items.find((x) => x.name === o.obj);
  if (!found) throw new Error(`нет объекта «${o.obj}» у ${persona}`);
  if (o.scenario) await devScenario(page, { scenario: o.scenario });
  await app(`/t/${tenant}/repair?obj=${found.id}&tab=${o.tab ?? 'measure'}`, { persona });
  return { tenant, project: found.id };
}

/** Заказчик согласует отправленную версию в кабинете (публичная операция по ссылке). */
export async function approveByClient(page: Page, at: Opened, version: number): Promise<void> {
  const link = await call(
    page,
    'POST',
    `/api/v1/tenants/${at.tenant}/repairs/projects/${at.project}/client-link`,
  );
  if (link.status !== 201) throw new Error(`issueClientLink ${link.status}`);
  const token = (link.body as { url: string }).url.split('/').pop();
  const r = await call(page, 'POST', `/api/v1/public/client/${token}/estimates/${version}/approve`);
  if (r.status !== 200) throw new Error(`approveEstimateByClient ${r.status}`);
}

/** Текст без лигатур иконок Material Symbols. */
export async function plainText(el: Locator): Promise<string> {
  return el.evaluate((n) => {
    const c = n.cloneNode(true) as Element;
    c.querySelectorAll('.material-symbols-rounded').forEach((i) => i.remove());
    return (c.textContent ?? '').trim();
  });
}
