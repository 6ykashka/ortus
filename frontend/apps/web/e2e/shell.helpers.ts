// W1.20 · Помощники e2e оболочки: запросы к API из страницы (в режиме mock ответ даёт service worker MSW —
// page.request его не видит), сценарии и пресеты сценарного сервера W0.13 (`POST /api/v1/dev/scenario`,
// только mock), организации из /me/context. Порты и адреса — из фикстур харнесса.
import type { Locator, Page } from '@playwright/test';

export const ALTA = 'Альта Групп';
export const LOTOS = 'SPA «Лотос»';

export interface Reply {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/** Запрос из страницы с cookie-сессией; изменяющий — с CSRF и Idempotency-Key (контракт W0.08). */
export async function call(
  page: Page,
  method: string,
  path: string,
  o: { body?: unknown; ifMatch?: string } = {},
): Promise<Reply> {
  return page.evaluate(
    async ({ method, path, body, ifMatch }) => {
      const headers: Record<string, string> = {};
      if (method !== 'GET') {
        const csrf = /(?:^|;\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1];
        if (csrf) headers['X-CSRF-Token'] = decodeURIComponent(csrf);
        headers['Idempotency-Key'] = crypto.randomUUID();
      }
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (ifMatch) headers['If-Match'] = ifMatch;
      const r = await fetch(path, {
        method,
        credentials: 'include',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      return {
        status: r.status,
        headers: Object.fromEntries(r.headers.entries()),
        body: text ? (JSON.parse(text) as unknown) : null,
      };
    },
    { method, path, body: o.body, ifMatch: o.ifMatch },
  );
}

/** Пресет или сценарий сценарного сервера (только режим mock). */
export async function devScenario(
  page: Page,
  body: { preset?: string; scenario?: string | null; once?: boolean; reset?: boolean },
): Promise<void> {
  const r = await call(page, 'POST', '/api/v1/dev/scenario', { body });
  if (r.status !== 200) throw new Error(`dev/scenario ${r.status}: ${JSON.stringify(r.body)}`);
}

interface TenantLike {
  tenantId: string;
  name: string;
}

/** Id организации по имени из /me/context текущего входа. */
export async function tenantId(page: Page, name = ALTA): Promise<string> {
  const me = (await call(page, 'GET', '/api/v1/me/context')).body as { tenants: TenantLike[] };
  const t = me.tenants.find((x) => x.name === name);
  if (!t) throw new Error(`нет организации «${name}» в /me/context`);
  return t.tenantId;
}

/** Подключить или отключить модуль (владелец; If-Match по ETag, контракт setModuleInstallation). */
export async function setModule(
  page: Page,
  tenant: string,
  moduleKey: string,
  enabled: boolean,
): Promise<void> {
  const path = `/api/v1/tenants/${tenant}/modules/${moduleKey}`;
  const cur = await call(page, 'GET', path);
  const etag = cur.headers.etag ?? '';
  const body = enabled ? { enabled } : { enabled, retainedAccess: 'history_read' };
  const r = await call(page, 'PUT', path, { body, ifMatch: etag });
  if (r.status !== 200)
    throw new Error(`setModuleInstallation ${r.status}: ${JSON.stringify(r.body)}`);
}

/** Подписи кнопок меню (атрибут title — подпись пункта, в рейле подпись скрыта визуально). */
export async function navTitles(nav: Locator): Promise<string[]> {
  return nav.locator('button').evaluateAll((els) => els.map((e) => e.getAttribute('title') ?? ''));
}
