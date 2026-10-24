// W4.13 · Помощники e2e вкладок проекта «Участники», «Процесс», «Автоматизация» и старой доски «Заявки»: проект
// по ключу из listTaskProjects (из страницы — MSW отвечает service worker), переход по прямому URL
// `/t/:tenantId/tasks?project=<id>&view=<вкладка>` (ADR-0001) и `/t/:tenantId/leads`.
import type { Persona } from '@ortus/e2e-kit';
import type { Locator, Page } from '@playwright/test';

import { ALTA, call, devScenario, tenantId } from './shell.helpers.ts';

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<unknown>;

export type SettingsView = 'people' | 'workflow' | 'automation';

export const TAB: Readonly<Record<SettingsView, string>> = {
  people: 'Участники',
  workflow: 'Процесс',
  automation: 'Автоматизация',
};

interface ProjectLike {
  id: string;
  key: string;
}

/** Id проекта по ключу (LOG, ЗАЯ) из listTaskProjects текущего входа. */
export async function projectId(page: Page, tenant: string, key: string): Promise<string> {
  const r = await call(page, 'GET', `/api/v1/tenants/${tenant}/projects?limit=200`);
  const items = (r.body as { items?: ProjectLike[] } | null)?.items ?? [];
  const p = items.find((x) => x.key === key);
  if (!p) throw new Error(`нет проекта ${key} (listTaskProjects ${String(r.status)})`);
  return p.id;
}

/** Вход персонажа и вкладка проекта `key` по прямому URL; возвращает id организации и проекта. */
export async function openProjectTab(
  app: AppFn,
  page: Page,
  view: SettingsView,
  o: { persona?: Persona; key?: string; tenant?: string; scenario?: string } = {},
): Promise<{ tenant: string; project: string }> {
  const persona = o.persona ?? 'owner';
  await app('/', { persona });
  const tenant = await tenantId(page, o.tenant ?? ALTA);
  const project = await projectId(page, tenant, o.key ?? 'LOG');
  if (o.scenario) await devScenario(page, { scenario: o.scenario });
  await app(`/t/${tenant}/tasks?project=${project}&view=${view}`, { persona });
  await tabs(page).getByRole('tab', { name: TAB[view] }).waitFor({ timeout: 15_000 });
  return { tenant, project };
}

/** Пункт меню «Задачи»: боковая панель или «Ещё» нижней навигации телефона (< 640 px). */
export async function openTasksFromMenu(page: Page): Promise<void> {
  if ((page.viewportSize()?.width ?? 1440) < 640) {
    await page
      .getByRole('navigation', { name: 'Навигация', exact: true })
      .getByRole('button', { name: 'Ещё' })
      .click();
    await page
      .getByRole('dialog', { name: 'Все разделы' })
      .getByRole('button', { name: 'Задачи' })
      .click();
  } else {
    await page
      .getByRole('navigation', { name: 'Основная навигация' })
      .getByRole('button', { name: 'Задачи' })
      .click();
  }
}

export const tabs = (page: Page): Locator => page.getByRole('tablist', { name: 'Разделы проекта' });

export const tab = (page: Page, view: SettingsView): Locator =>
  tabs(page).getByRole('tab', { name: TAB[view] });

/** Содержимое вкладки проекта (W4.13). */
export const pane = (page: Page): Locator => page.locator('.ox-tset');

/** Цвет и насыщенность текста первой главной кнопки вкладки (.ox-tset-primary). */
export async function primaryText(page: Page): Promise<{ color: string; weight: string }> {
  return pane(page)
    .locator('.ox-tset-primary')
    .first()
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, weight: s.fontWeight };
    });
}

/** Строки таблицы «Участники». */
export const memberRows = (page: Page): Locator => pane(page).locator('.ox-tset-mrow');

/** Блок «Проверить доступ». */
export const checkBox = (page: Page): Locator => pane(page).locator('.ox-tset-check');

/** Старая доска «Заявки» (`/t/:tenantId/leads`). */
export async function openLeads(
  app: AppFn,
  page: Page,
  o: { persona?: Persona; tenant?: string; scenario?: string; search?: string } = {},
): Promise<string> {
  const persona = o.persona ?? 'owner';
  await app('/', { persona });
  const tenant = await tenantId(page, o.tenant ?? ALTA);
  if (o.scenario) await devScenario(page, { scenario: o.scenario });
  await app(`/t/${tenant}/leads${o.search ?? ''}`, { persona });
  return tenant;
}

export const leads = (page: Page): Locator => page.locator('section[aria-labelledby="h-tasks"]');
