// W0.09 · smoke шага 0.7 (S0-04, критерий выхода этапа 0 плана 27): браузер → BFF (dev-вход) → API → control DB
// → tenant DB с проверкой права. Только режим stand (E2E_MODE=stand): API cmd/api, миграции и Go-сид W0.06;
// в режиме mock ответы дают MSW-хендлеры W0.13, их ещё нет.
import { expect, test } from './fixtures/index.ts';

test.describe('GET /me/context сквозь стек @stand', () => {
  test.beforeEach(({ harness }) => {
    test.skip(harness.mode !== 'stand', 'нужен стенд: E2E_MODE=stand (MSW режима mock — W0.13)');
  });

  test('владелец входит dev-провайдером и видит себя и «Альту»', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    await expect(page.getByRole('heading', { name: 'Дарья Зимина' })).toBeVisible();
    await expect(page.getByText('Альта Групп')).toBeVisible();
  });

  test('без входа — 401 и «Нужен вход»', async ({ app, page }) => {
    const me = page.waitForResponse((r) => r.url().endsWith('/api/v1/me/context'));
    await app('/');
    expect((await me).status()).toBe(401);
    await expect(page.getByText('Нужен вход')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Войти' })).toHaveAttribute('href', '/auth/login');
  });

  test('проверка права: listMembers — менеджеру 403, владельцу пропуск (501, тег не реализован)', async ({
    app,
    page,
  }) => {
    const members = async () => {
      const me = (await (await page.request.get('/api/v1/me/context')).json()) as {
        tenants: { tenantId: string; name: string }[];
      };
      const alta = me.tenants.find((t) => t.name === 'Альта Групп');
      expect(alta).toBeTruthy();
      return page.request.get(`/api/v1/tenants/${alta?.tenantId}/members`);
    };

    await app('/', { persona: 'manager' });
    const denied = await members();
    expect(denied.status()).toBe(403);
    expect(((await denied.json()) as { code: string }).code).toBe('forbidden_action');

    await app('/', { persona: 'owner' });
    const passed = await members();
    expect(passed.status()).toBe(501);
    expect(((await passed.json()) as { code: string }).code).toBe('not_implemented');
  });
});
