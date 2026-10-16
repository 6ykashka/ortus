// W0.09 · smoke шага 0.7 (S0-04, критерий выхода этапа 0 плана 27): браузер → BFF (dev-вход) → API → control DB
// → tenant DB с проверкой права. Оба режима (W0.13): stand — cmd/api, миграции и Go-сид W0.06; mock — MSW-сценарный
// сервер W0.13 в браузере (запросы идут из страницы через service worker, поэтому — fetch страницы, а не
// page.request, который service worker не видит).
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/index.ts';

/** GET из страницы с cookie сессии: в режиме mock ответ даёт service worker MSW. */
async function get(page: Page, path: string): Promise<{ status: number; body: unknown }> {
  return page.evaluate(async (url) => {
    const r = await fetch(url, { credentials: 'include' });
    return { status: r.status, body: (await r.json()) as unknown };
  }, path);
}

test.describe('GET /me/context сквозь стек @stand @mock', () => {
  test('владелец входит dev-провайдером и видит себя и «Альту»', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    // W1.20: экран контекста / заменён оболочкой (ADR-0001): организация — в шапке, имя — в «Профиле».
    await expect(page.getByRole('banner')).toContainText('Альта Групп');
    await page.getByRole('button', { name: 'Профиль' }).click();
    await expect(page.getByRole('dialog', { name: 'Профиль' })).toContainText('Дарья Зимина');
  });

  test('без входа — 401 и «Нужен вход»', async ({ app, page }) => {
    const me = page.waitForResponse((r) => r.url().endsWith('/api/v1/me/context'));
    await app('/');
    expect((await me).status()).toBe(401);
    await expect(page.getByText('Нужен вход')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Войти' })).toHaveAttribute('href', '/auth/login');
  });

  test('проверка права: listMembers — менеджеру 403, владельцу 200 и список «Альты»', async ({
    app,
    page,
  }) => {
    const members = async () => {
      const me = (await get(page, '/api/v1/me/context')).body as {
        tenants: { tenantId: string; name: string }[];
      };
      const alta = me.tenants.find((t) => t.name === 'Альта Групп');
      expect(alta).toBeTruthy();
      return get(page, `/api/v1/tenants/${alta?.tenantId}/members`);
    };

    await app('/', { persona: 'manager' });
    const denied = await members();
    expect(denied.status).toBe(403);
    expect((denied.body as { code: string }).code).toBe('forbidden_action');

    await app('/', { persona: 'owner' });
    const passed = await members();
    // Шлюз пропустил, хендлер W1.05 отдал список в обоих режимах: владелец видит людей «Альты», среди них себя.
    // Точное число не проверяется: Go-сид стенда и сценарий MSW пополняют разные WS, smoke не должен краснеть
    // от их рассинхронизации.
    expect(passed.status).toBe(200);
    const items = (passed.body as { items: { displayName: string }[] }).items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.map((m) => m.displayName)).toContain('Дарья Зимина');
  });
});
