// W6.24 · Помощники e2e вкладок «Документы», «Финансы», «Оплата бригады», «Подрядчики», «Кабинет заказчика»:
// вход владельца «Альты» с пресетом `repairs-ready`, id объекта кв. 42 по названию, подпись акта заказчиком
// через публичную операцию (в режиме mock код подписи фиксирован: SIGN_CODE адаптера).
import type { Persona } from '@ortus/e2e-kit';
import type { Locator, Page } from '@playwright/test';

import { call, devScenario, tenantId } from './shell.helpers.ts';

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<unknown>;

export type MoneyTab = 'docs' | 'finance' | 'pay' | 'subs' | 'client';

export const OBJECT_42 = 'ЖК Речной · квартира 42';
/** Код подписи заглушки порта SMS в сценарном сервере (adapter/src/msw/repairs/cabinet.ts). */
export const SIGN_CODE = '482910';

interface Item {
  id: string;
  name: string;
}

/** Id объекта по названию (владелец видит все объекты организации). */
export async function projectId(page: Page, tenant: string, name = OBJECT_42): Promise<string> {
  const r = await call(page, 'GET', `/api/v1/tenants/${tenant}/repairs/projects`);
  const items = (r.body as { items?: Item[] } | null)?.items;
  if (r.status !== 200 || !items)
    throw new Error(`projects ${r.status}: ${JSON.stringify(r.body)}`);
  const found = items.find((p) => p.name === name);
  if (!found) throw new Error(`нет объекта «${name}»: ${JSON.stringify(r.body)}`);
  return found.id;
}

/** Вкладка объекта кв. 42 владельцем с пресетом «Ремонт и стройка подключён». */
export async function openMoney(
  app: AppFn,
  page: Page,
  tab: MoneyTab,
  o: { persona?: Persona; object?: string } = {},
): Promise<{ tenant: string; project: string }> {
  const persona = o.persona ?? 'owner';
  await app('/', { persona });
  const tenant = await tenantId(page);
  await devScenario(page, { preset: 'repairs-ready' });
  // Пресет переводит часы сервера на 20.10.2026: прежняя сессия истекла, входим заново.
  await app('/', { persona });
  const project = await projectId(page, tenant, o.object);
  await app(`/t/${tenant}/repair?obj=${project}&tab=${tab}`, { persona });
  return { tenant, project };
}

interface Doc {
  id: string;
  kind: string;
  actNo?: number;
  state: string;
}

/** Документ подписан заказчиком: запрос кода владельцем, подпись по публичной ссылке (как в кабинете W6.26). */
export async function signDocument(
  page: Page,
  tenant: string,
  project: string,
  find: (d: Doc) => boolean,
): Promise<void> {
  const list = await call(
    page,
    'GET',
    `/api/v1/tenants/${tenant}/repairs/projects/${project}/documents`,
  );
  const doc = (list.body as { items: Doc[] }).items.find(find);
  if (!doc) throw new Error('нет подходящего документа');
  if (doc.state === 'draft' || doc.state === 'wait') {
    const q = await call(
      page,
      'POST',
      `/api/v1/tenants/${tenant}/repairs/documents/${doc.id}/sign-requests`,
    );
    if (q.status !== 201) throw new Error(`sign-requests ${q.status}: ${JSON.stringify(q.body)}`);
  }
  const link = await call(
    page,
    'POST',
    `/api/v1/tenants/${tenant}/repairs/projects/${project}/client-link`,
  );
  const url = (link.body as { url: string }).url;
  const token = url.slice(url.lastIndexOf('/') + 1);
  const s = await call(page, 'POST', `/api/v1/public/client/${token}/documents/${doc.id}/sign`, {
    body: { smsCode: SIGN_CODE },
  });
  if (s.status !== 200) throw new Error(`sign ${s.status}: ${JSON.stringify(s.body)}`);
}

/** Акт № n подписан заказчиком. */
export const signAct = (page: Page, tenant: string, project: string, n = 1): Promise<void> =>
  signDocument(page, tenant, project, (d) => d.kind === 'act' && d.actNo === n);

/** Акт сдачи объекта подписан заказчиком. */
export const signHandover = (page: Page, tenant: string, project: string): Promise<void> =>
  signDocument(page, tenant, project, (d) => d.kind === 'handover_act');

/** Переход на вкладку объекта кнопкой хоста (после действий через API — повторный запрос данных). */
export async function goTab(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
}
/** Раздел вкладки по заголовку второго уровня (эталон: h2 20 px, `section[aria-labelledby]`). */
export const section = (page: Page, name: string): Locator =>
  page.getByRole('region', { name, exact: true });
