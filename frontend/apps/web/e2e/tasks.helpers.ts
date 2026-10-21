// W4.12 · Помощники e2e «Задач и проектов» (`tasks-projects`, `tasks-project-new`, `tasks-board`, `modal-new-task`,
// `tasks-card`; эталон design-2026-10-19 «Задачи и проекты.dc.html»): вход персонажа, страница `tasks` организации,
// проект LOG «Логистика · Север» сида W4.10 (MSW W4.03), карточка задачи, хранилище mock для вложений.
import type { Persona } from '@ortus/e2e-kit';
import { expect, type Locator, type Page } from '@playwright/test';

import { openPage, toast } from './modules.helpers.ts';
import { call, devScenario } from './shell.helpers.ts';

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<unknown>;

/** Хост билета загрузки сценарного сервера (adapter/src/msw/files). */
const STORAGE = 'https://storage.example.invalid/**';

export const LOG = 'Логистика · Север';
export const LEADS = 'Заявки · Ремонт';
export const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';
export const T65 = 'Заменить шины на ГАЗон Next (зимние)';
export const T66 = 'Подготовить парк к зиме';
export const T58 = 'Записать ГАЗон Next на плановое ТО';
export const T64 = 'Найти водителя на рейс Р-211';

export { toast };

/** Корень страницы «Задачи». */
export const root = (page: Page): Locator => page.locator('.ox-tasks');
/** Таблица проектов. */
export const projectRows = (page: Page): Locator => root(page).locator('.ox-tk-prow');
export const projectRow = (page: Page, name: string): Locator =>
  projectRows(page).filter({ hasText: name });
/** Панель «Новый проект». */
export const wizard = (page: Page): Locator => root(page).locator('.ox-tk-wiz');
/** Вкладки проекта. */
export const tabs = (page: Page): Locator =>
  root(page).getByRole('tablist', { name: 'Разделы проекта' });
export const tab = (page: Page, name: string): Locator => tabs(page).getByRole('tab', { name });
/** Колонки доски: имя (заглавными по CSS) и счётчик. */
export const columns = (page: Page): Locator => root(page).locator('.ox-tk-col');
export const column = (page: Page, name: string): Locator =>
  columns(page).filter({
    has: page.locator('.ox-tk-col-name', { hasText: new RegExp(`^${name}$`) }),
  });
/** Карточка задачи на доске по теме. */
export const boardCard = (page: Page, title: string): Locator =>
  root(page).locator('.ox-tk-kcard').filter({ hasText: title });
/** Фильтры доски. */
export const filter = (page: Page, name: string | RegExp): Locator =>
  root(page).locator('.ox-tk-filters').getByRole('button', { name });
/** Боковая карточка задачи. */
export const card = (page: Page): Locator => root(page).locator('.ox-tk-card');
/** Диалог «Новая задача». */
export const newTask = (page: Page): Locator => page.getByRole('dialog', { name: 'Новая задача' });

/** «Задачи» организации по прямому URL (`search` — параметры адреса). */
export async function openTasks(
  app: AppFn,
  page: Page,
  o: { persona?: Persona; search?: string; tenant?: string } = {},
): Promise<string> {
  await page.context().route(STORAGE, (r) => r.fulfill({ status: 200 }));
  const id = await openPage(app, page, `tasks${o.search ?? ''}`, {
    persona: o.persona ?? 'owner',
    ...(o.tenant ? { tenant: o.tenant } : {}),
  });
  return id;
}

/** Список проектов загружен. */
export async function projectsReady(page: Page): Promise<void> {
  await expect(root(page).getByRole('heading', { level: 2, name: 'Проекты' })).toBeVisible({
    timeout: 15_000,
  });
}

/** Открыть проект из списка и дождаться доски. */
export async function openProject(page: Page, name = LOG): Promise<void> {
  await projectsReady(page);
  await projectRow(page, name).click();
  await expect(tab(page, 'Доска')).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  await expect(columns(page).first()).toBeVisible({ timeout: 15_000 });
}

/** Открыть карточку задачи на доске. */
export async function openCard(page: Page, title: string): Promise<void> {
  await boardCard(page, title).click();
  await expect(card(page).getByRole('heading', { level: 3, name: title })).toBeVisible({
    timeout: 15_000,
  });
}

/** Сценарий сценарного сервера (только mock). */
export const scenario = (page: Page, s: string | null): Promise<void> =>
  devScenario(page, { scenario: s });

/** Завершает проверку загруженных файлов (dev-маршрут `scanFiles`). */
export async function scanFiles(page: Page): Promise<void> {
  await call(page, 'POST', '/api/v1/dev/scenario', { body: { scanFiles: true } });
}

/**
 * Роль участника в проекте `project` (setTaskProjectMemberRole от имени текущего входа — владельца): «Наблюдатель» —
 * только чтение задач. Состояние сценарного сервера сохраняется при смене персонажа.
 */
export async function setProjectRole(
  page: Page,
  tenant: string,
  member: string,
  role: string,
  project = LOG,
): Promise<void> {
  const base = `/api/v1/tenants/${tenant}/projects`;
  const list = (await call(page, 'GET', base)).body as { items: { id: string; name: string }[] };
  const p = list.items.find((x) => x.name === project);
  if (!p) throw new Error(`нет проекта «${project}»`);
  const head = await call(page, 'GET', `${base}/${p.id}`);
  const ms = (await call(page, 'GET', `${base}/${p.id}/members`)).body as {
    items: { memberId: string; displayName: string }[];
    roles: { roleId: string; name: string }[];
  };
  const m = ms.items.find((x) => x.displayName === member);
  const r = ms.roles.find((x) => x.name === role);
  if (!m || !r) throw new Error(`нет участника «${member}» или роли «${role}» в «${project}»`);
  const res = await call(page, 'PUT', `${base}/${p.id}/members/${m.memberId}`, {
    body: { roleId: r.roleId },
    ...(head.headers.etag ? { ifMatch: head.headers.etag } : {}),
  });
  if (res.status !== 200) throw new Error(`setTaskProjectMemberRole ${res.status}`);
}

/** Tab до элемента (не больше `max` нажатий); true — элемент в фокусе. */
export async function tabTo(page: Page, target: Locator, max = 80): Promise<boolean> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return true;
  }
  return false;
}

/** Видимая рамка фокуса у элемента: outline или box-shadow. */
export const ringVisible = (el: Locator): Promise<boolean> =>
  el.evaluate((x) => {
    const s = getComputedStyle(x);
    return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
  });

/** PDF в 1 КБ для выбора файла. */
export const PDF = { name: 'Акт.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(1024, 37) };
/** Пустой файл. */
export const EMPTY = { name: 'Пустой.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) };
/** Файл недопустимого типа. */
export const EXE = {
  name: 'setup.exe',
  mimeType: 'application/x-msdownload',
  buffer: Buffer.alloc(64, 1),
};

/** Телефон: ширина окна меньше 640 px. */
export const phone = (page: Page): boolean => (page.viewportSize()?.width ?? 1440) < 640;
