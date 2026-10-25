// W4.23 · Помощники e2e вкладок редактора формы «Формы и опросы» (эталон design-2026-10-19 «Формы и опросы.dc.html»):
// вход персонажа и форма «Альты» по прямому URL `?form=&tab=` (ADR-0001), вкладки, диалог «Поделиться формой»,
// запросы к API тега Forms из страницы (в режиме mock ответ даёт service worker MSW), цели нажатия и axe.
import type { Persona } from '@ortus/e2e-kit';
import type { Locator, Page } from '@playwright/test';

import { hitHeight } from './modules.helpers.ts';
import { call, devScenario, tenantId } from './shell.helpers.ts';

export { call, devScenario };

export const INSP = 'Осмотр машины';
export const FOREMAN = 'Ежедневный отчёт прораба';
export const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<unknown>;
export type Tab = 'build' | 'settings' | 'actions' | 'responses' | 'versions';

export const TAB_LABEL: Record<Tab, string> = {
  build: 'Конструктор',
  settings: 'Настройки',
  actions: 'Действия после ответа',
  responses: 'Ответы',
  versions: 'Версии',
};

/** Id формы организации по названию (`listForms` из страницы). */
export async function formIdOf(page: Page, tenant: string, name: string): Promise<string> {
  const r = await call(page, 'GET', `/api/v1/tenants/${tenant}/forms?limit=200`);
  const items = (r.body as { items?: { id: string; name: string }[] } | null)?.items ?? [];
  const f = items.find((x) => x.name === name);
  if (!f) throw new Error(`нет формы «${name}» (${r.status})`);
  return f.id;
}

export interface Opened {
  tenant: string;
  form: string;
}

/**
 * Вход персонажа, затем форма `name` «Альты» на вкладке `tab` по прямому URL; `extra` — ещё параметры адреса
 * (`&resp=`). `before` — шаги до перехода на форму (пресеты, сценарии, подготовка данных через API).
 */
export async function openForm(
  app: AppFn,
  page: Page,
  o: {
    persona?: Persona;
    name?: string;
    tab?: Tab;
    extra?: string;
    before?: (x: Opened) => Promise<void>;
  } = {},
): Promise<Opened> {
  const persona = o.persona ?? 'owner';
  await app('/', { persona });
  await page
    .waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 15_000 })
    .catch(() => undefined);
  const tenant = await tenantId(page);
  // Пресет «Логистика подключена»: Марина Котова — «Менеджер логистики» (видит формы и ответы, без «Настраивать»).
  await devScenario(page, { preset: 'logistics-ready' });
  const form = await formIdOf(page, tenant, o.name ?? INSP);
  await o.before?.({ tenant, form });
  const tab = o.tab ? `&tab=${o.tab}` : '';
  await app(`/t/${tenant}/forms?form=${form}${tab}${o.extra ?? ''}`, { persona });
  await editor(page).waitFor({ timeout: 20_000 });
  return { tenant, form };
}

/**
 * Текущий адрес заново через фикстуру `app` (ждёт входа персонажа, то есть service worker MSW) — вместо голого
 * `page.reload()`, после которого запросы изредка уходили мимо MSW в прокси Vite (ECONNREFUSED на порт API).
 */
export async function reopen(app: AppFn, page: Page, persona: Persona = 'owner'): Promise<void> {
  const u = new URL(page.url());
  await app(`${u.pathname}${u.search}`, { persona });
}

/**
 * Из меню «Формы и опросы» (на телефоне — «Ещё» → «Все разделы»): список W4.22 → «Осмотр машины» → вкладка `t`
 * (verification-protocol §1.3: страница открывается из меню).
 */
export async function openFromMenu(app: AppFn, page: Page, t: Tab): Promise<void> {
  await openForm(app, page, { tab: 'build' });
  if (phone(page)) {
    await page
      .getByRole('navigation', { name: 'Навигация', exact: true })
      .getByRole('button', { name: 'Ещё' })
      .click();
    await page
      .getByRole('dialog', { name: 'Все разделы' })
      .getByRole('button', { name: 'Формы и опросы' })
      .click();
  } else {
    await page
      .getByRole('navigation', { name: 'Основная навигация' })
      .getByRole('button', { name: 'Формы и опросы' })
      .click();
  }
  await page.waitForURL(/\/forms$/);
  await page.locator('.ox-fm-row').filter({ hasText: INSP }).locator('.ox-fm-row-open').click();
  await tab(page, t).click();
  await page.waitForURL(new RegExp(`[?&]tab=${t}`));
}

/**
 * Вкладка `t` «Осмотра машины» по прямому URL у логиста Котовой без пресета «Логистика подключена» — без роли с
 * правами «Форм» (verification-protocol §1.3: «нет права»).
 */
export async function openWithoutRight(app: AppFn, page: Page, t: Tab): Promise<void> {
  await app('/', { persona: 'owner' });
  await page
    .waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 15_000 })
    .catch(() => undefined);
  const tenant = await tenantId(page);
  const form = await formIdOf(page, tenant, INSP);
  await app(`/t/${tenant}/forms?form=${form}&tab=${t}`, { persona: 'manager' });
}

/** Заголовок закрытого раздела («Нет доступа» или «Модуль не подключён»). */
export const noAccess = (page: Page): Locator =>
  page.getByRole('heading', { name: /Нет доступа|не подключ/ });

export const editor = (page: Page): Locator => page.locator('.ox-fm-editor');
export const tablist = (page: Page): Locator =>
  page.getByRole('tablist', { name: 'Разделы формы' });
export const tab = (page: Page, t: Tab): Locator =>
  tablist(page).getByRole('tab', { name: new RegExp(`^${TAB_LABEL[t]}`) });
export const toast = (page: Page): Locator => page.locator('.ox-toast .ox-toast-text');
export const dialog = (page: Page): Locator => page.getByRole('dialog');
export const phone = (page: Page): boolean => (page.viewportSize()?.width ?? 1440) < 640;

/** Ширина области нажатия по горизонтали через центр цели (пара к `hitHeight`). */
export async function hitWidth(target: Locator): Promise<number> {
  return target.evaluate((el) => {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const y = r.top + r.height / 2;
    let n = 0;
    for (let x = Math.floor(r.left) - 30; x <= Math.ceil(r.right) + 30; x++) {
      const hit = document.elementFromPoint(x, y);
      if (hit && (hit === el || el.contains(hit))) n++;
    }
    return n;
  });
}

/**
 * Цели нажатия области `root` на телефоне меньше 44 × 44 px (verification-protocol §1.3): «подпись: высота×ширина».
 * Флажок и радио внутри `label` меряются по `label` (нажатие на подпись переключает их).
 */
export async function smallTargets(root: Locator): Promise<string[]> {
  const els = root.locator('button, select, textarea, input:not([type="hidden"]), a[href]');
  const out: string[] = [];
  for (const el of await els.all()) {
    if (!(await el.isVisible())) continue;
    if ((await el.getAttribute('aria-hidden')) === 'true') continue;
    const type = await el.getAttribute('type');
    const label = el.locator('xpath=ancestor::label[1]');
    const target = (type === 'checkbox' || type === 'radio') && (await label.count()) ? label : el;
    const h = await hitHeight(target);
    const w = await hitWidth(target);
    if (h >= 44 && w >= 44) continue;
    const name =
      (await el.getAttribute('aria-label')) ??
      (await el.evaluate(
        (e) => (e as HTMLElement).innerText || (e as HTMLInputElement).placeholder || e.tagName,
      ));
    out.push(`${name.replace(/\s+/g, ' ').trim().slice(0, 48)}: ${h}×${w}`);
  }
  return out;
}

type AxeResult = {
  violations: { id: string; impact?: string | null; nodes: { target: unknown[] }[] }[];
};

/** Нарушения axe уровня serious и critical: «правило: цели». */
export async function serious(page: Page, axe: (p: Page) => Promise<AxeResult>): Promise<string[]> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return (await axe(page)).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/**
 * W4.73 · Режим stand: вход персонажа и форма `name` «Альты» на вкладке `tab` по прямому URL — как `openForm`, но без
 * пресета `logistics-ready` и без `before`: `/api/v1/dev/scenario` есть только у сценарного сервера MSW (на стенде —
 * 404), роли и модули владельцу даёт сид стенда (W4.21).
 */
export async function openStandForm(
  app: AppFn,
  page: Page,
  o: { persona?: Persona; name?: string; tab?: Tab; extra?: string } = {},
): Promise<Opened> {
  const persona = o.persona ?? 'owner';
  await app('/', { persona });
  const tenant = await tenantId(page);
  const form = await formIdOf(page, tenant, o.name ?? INSP);
  const tab = o.tab ? `&tab=${o.tab}` : '';
  await app(`/t/${tenant}/forms?form=${form}${tab}${o.extra ?? ''}`, { persona });
  await editor(page).waitFor({ timeout: 20_000 });
  return { tenant, form };
}

/** W4.73 · Id ответа формы по номеру («R-1012»): `listFormResponses` по всем страницам курсора. */
export async function responseIdOf(page: Page, o: Opened, number: string): Promise<string> {
  let cursor = '';
  for (let i = 0; i < 20; i++) {
    const q = `?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const r = await call(page, 'GET', `${formsApi(o)}/responses${q}`);
    const body = r.body as { items?: { id: string; number: string }[]; nextCursor?: string | null };
    const hit = body.items?.find((x) => x.number === number);
    if (hit) return hit.id;
    if (!body.nextCursor) break;
    cursor = body.nextCursor;
  }
  throw new Error(`нет ответа ${number} формы ${o.form}`);
}

/** Корень формы API тега Forms. */
export const formsApi = (o: Opened): string => `/api/v1/tenants/${o.tenant}/forms/${o.form}`;

/** ETag формы — If-Match `updateForm`. */
export async function formEtag(page: Page, o: Opened): Promise<string> {
  const r = await call(page, 'GET', formsApi(o));
  return r.headers.etag ?? '';
}

/** Изменить форму через API (`updateForm`, If-Match по ETag). */
export async function patchForm(page: Page, o: Opened, body: unknown): Promise<void> {
  const r = await call(page, 'PATCH', formsApi(o), { body, ifMatch: await formEtag(page, o) });
  if (r.status !== 200) throw new Error(`updateForm ${r.status}: ${JSON.stringify(r.body)}`);
}
