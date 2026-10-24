// W1.22 · e2e страницы `auth-login` — экран входа `/auth/login` (S1-05, no-reference до B-6 №1; бриф
// docs/plan/v2/ws/W1.22.md §5). «Войти» — навигация на BFF startLogin (OIDC Code + PKCE): в режиме mock её имитирует
// page.route (service worker MSW навигацию не перехватывает), на стенде отвечает cmd/api с dev-провайдером.
import type { Page } from '@playwright/test';

import { fakeIdp, overflowX, serious, START_LOGIN } from './auth.helpers.ts';
import { expect, test } from './fixtures/index.ts';
import { ALTA, tenantId } from './shell.helpers.ts';

const LOGIN = '/auth/login';
/**
 * Ожидание оболочки после провайдера: приложение грузится заново (dev-сервер, MSW) — под нагрузкой дольше 5 с
 * ожидания expect (W2.81, возврат 1). 15 с — половина таймаута строки (30 с): вторая половина остаётся проверкам
 * после входа; первый вход openApp (e2e-kit) ждёт загрузку приложения до таймаута строки, так что здесь ожидание
 * строже. Время загрузки приложения e2e mock не меряет: dev-сервер Vite собирает модули по запросу, сборки для
 * пользователей здесь нет (W2.81, возврат 2). Строка «дольше 5 с» ниже — единственная регрессия класса и для
 * auth-invitation.spec.ts.
 */
const RELOAD_AFTER_IDP = 15_000;
const signIn = (page: Page) => page.getByRole('button', { name: 'Войти', exact: true });

/**
 * Навигация на startLogin (режим mock): адрес записывается, ответ 204 — браузер остаётся на экране входа (кнопка
 * «Переходим ко входу…» видна), к BFF ничего не уходит.
 */
async function catchStartLogin(page: Page): Promise<{ url: () => string }> {
  let seen = '';
  await page.route(`**${START_LOGIN}**`, async (route) => {
    const u = new URL(route.request().url());
    seen = u.pathname + u.search;
    await route.fulfill({ status: 204, body: '' });
  });
  return { url: () => seen };
}

test.describe('auth-login — экран входа @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'имитация BFF — режим mock');

  test('экран «Вход»: заголовок, «Войти», без оболочки и без запросов к API', async ({
    app,
    page,
  }) => {
    const api: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/')) api.push(r.url());
    });
    await app(LOGIN);
    await expect(page.getByRole('heading', { level: 1, name: 'Вход' })).toBeVisible();
    await expect(
      page.getByText('Войдите, чтобы открыть рабочее пространство бизнеса.'),
    ).toBeVisible();
    await expect(signIn(page)).toBeEnabled();
    await expect(page.getByRole('banner')).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    expect(api).toEqual([]);
  });

  test('«Войти» → startLogin с returnTo из ?next=, кнопка занята до ухода', async ({
    app,
    page,
  }) => {
    const held = await catchStartLogin(page);
    await app(`${LOGIN}?next=${encodeURIComponent('/t/t-alta/users?tab=roles')}`);
    await signIn(page).click();
    await expect(page.getByRole('button', { name: 'Переходим ко входу…' })).toBeDisabled();
    await expect.poll(held.url).toBe(`${START_LOGIN}?returnTo=%2Ft%2Ft-alta%2Fusers%3Ftab%3Droles`);
  });

  // Строка на каждый адрес: четыре навигации в одной строке не укладывались в 30 с на холодном Vite (mobile-390).
  for (const next of ['//evil.example/x', 'https://evil.example/', '/\\evil.example', 'users']) {
    test(`?next=${next} вне приложения → returnTo=/`, async ({ app, page }) => {
      const held = await catchStartLogin(page);
      await app(`${LOGIN}?next=${encodeURIComponent(next)}`);
      await signIn(page).click();
      await expect.poll(held.url, { message: next }).toBe(`${START_LOGIN}?returnTo=%2F`);
    });
  }

  test('вход оператора: next=/platform/tenants — «Управление платформой»', async ({
    app,
    page,
  }) => {
    await app(`${LOGIN}?next=${encodeURIComponent('/platform/tenants')}`);
    await expect(
      page.getByText(
        'Вход в управление платформой. Отдельный вход · без доступа к данным клиентов.',
      ),
    ).toBeVisible();
    const held = await catchStartLogin(page);
    await signIn(page).click();
    await expect.poll(held.url).toBe(`${START_LOGIN}?returnTo=%2Fplatform%2Ftenants`);
  });

  test('ошибки входа ?error=: сессия истекла, отказ, сервис недоступен', async ({ app, page }) => {
    await app(`${LOGIN}?error=session_expired`);
    await expect(page.getByRole('status')).toContainText('Нужен вход');
    await expect(page.getByRole('status')).toContainText('Сессия истекла. Войдите снова.');
    await expect(page.getByRole('status')).not.toContainText('этот экран');
    await app(`${LOGIN}?error=session_expired&next=${encodeURIComponent('/t/t-alta/users')}`);
    await expect(page.getByRole('status')).toContainText(
      'Сессия истекла. Войдите снова — после входа вы вернётесь на прежнюю страницу.',
    );
    await app(`${LOGIN}?error=forbidden_action`);
    await expect(page.getByRole('alert')).toContainText('Вход не выполнен');
    await expect(page.getByRole('alert')).toContainText(
      'Вход отклонён: учётная запись заблокирована или доступ не подтверждён.',
    );
    await app(`${LOGIN}?error=dependency_unavailable`);
    await expect(page.getByRole('alert')).toContainText(
      'Сервис временно недоступен. Повторите позже.',
    );
    await app(`${LOGIN}?error=whatever`);
    await expect(page.getByRole('alert')).toContainText('Повторите вход.');
    await expect(signIn(page)).toBeEnabled();
  });

  test('подготовленная ссылка ?error=__proto__ / toString / constructor — «Повторите вход.», экран цел', async ({
    app,
    page,
  }) => {
    // Код из адреса — не ключ прототипа объекта.
    for (const code of ['__proto__', 'toString', 'constructor']) {
      await app(`${LOGIN}?error=${code}`);
      await expect(page.getByRole('alert'), code).toContainText('Повторите вход.');
      await expect(signIn(page)).toBeEnabled();
    }
  });

  test('выход выполнен: ?signedOut=1 — «Вы вышли», «Войти», без запросов к API', async ({
    app,
    page,
  }) => {
    const api: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/')) api.push(r.url());
    });
    await app(`${LOGIN}?signedOut=1`);
    await expect(page.getByRole('heading', { level: 1, name: 'Вход' })).toBeVisible();
    const status = page.getByRole('status');
    await expect(status).toContainText('Вы вышли');
    await expect(status).toContainText(
      'Сеанс на этом устройстве завершён. Чтобы продолжить работу, войдите снова.',
    );
    await expect(signIn(page)).toBeEnabled();
    await page.waitForLoadState('networkidle');
    expect(api).toEqual([]);
  });

  test('нет связи: «Войти» остаётся на экране — «Нет связи», со связью — уход на startLogin', async ({
    app,
    page,
    context,
  }) => {
    const held = await catchStartLogin(page);
    await app(LOGIN);
    await expect(signIn(page)).toBeEnabled();
    // Значок баннера — лигатура шрифта значков (файл ≈ 5,4 МБ): экран подгружает шрифт, пока связь есть, иначе без сети
    // вместо значка виден текст «warning». Ждём загрузку до обрыва — обрыв сразу после открытия гонялся бы с загрузкой.
    await expect
      .poll(
        () =>
          page.evaluate(() => document.fonts.check('20px "Material Symbols Rounded"', 'warning')),
        {
          timeout: 15_000,
        },
      )
      .toBe(true);
    await context.setOffline(true);
    await signIn(page).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Нет связи');
    await expect(alert).toContainText(
      'Проверьте подключение к интернету и нажмите «Войти» ещё раз.',
    );
    await expect(page).toHaveURL(new RegExp(`${LOGIN}$`));
    await expect(signIn(page)).toBeEnabled();
    expect(held.url()).toBe('');
    await context.setOffline(false);
    await signIn(page).click();
    await expect.poll(held.url).toBe(`${START_LOGIN}?returnTo=%2F`);
  });

  test('полный круг: «Войти» → провайдер → returnTo с сессией — оболочка «Альты»', async ({
    app,
    page,
  }) => {
    const seen = await fakeIdp(page, 'owner');
    await app(`${LOGIN}?next=${encodeURIComponent('/')}`);
    await signIn(page).click();
    await expect(page.getByRole('banner')).toContainText(ALTA, { timeout: RELOAD_AFTER_IDP });
    const alta = await tenantId(page);
    await expect(page).toHaveURL(new RegExp(`/t/${alta}/home$`));
    expect(seen).toEqual([`${START_LOGIN}?returnTo=%2F`]);
  });

  // W2.81, возврат 1: в полном прогоне под нагрузкой строка выше на 390 красная во всех трёх попытках —
  // после провайдера приложение грузится заново (dev-сервер, MSW), и оболочка появляется позже 5 с ожидания
  // expect. Медленная загрузка (вход приложения отвечает через 6 с) воспроизводит это без нагрузки.
  test('полный круг: приложение после провайдера грузится дольше 5 с — оболочка «Альты»', async ({
    app,
    page,
  }) => {
    const seen = await fakeIdp(page, 'owner');
    await app(`${LOGIN}?next=${encodeURIComponent('/')}`);
    await page.route('**/src/main.tsx*', async (route) => {
      await new Promise((r) => setTimeout(r, 6_000));
      await route.continue();
    });
    await signIn(page).click();
    await expect(page.getByRole('banner')).toContainText(ALTA, { timeout: RELOAD_AFTER_IDP });
    expect(seen).toEqual([`${START_LOGIN}?returnTo=%2F`]);
  });

  test('«Нужен вход» → «Войти» → экран входа', async ({ app, page }) => {
    await app('/');
    await expect(page.getByText('Нужен вход')).toBeVisible();
    await page.getByRole('link', { name: 'Войти' }).click();
    await expect(page).toHaveURL(/\/auth\/login$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Вход' })).toBeVisible();
  });

  test('клавиатура: Tab → «Войти» с видимым кольцом, Enter запускает вход', async ({
    app,
    page,
  }) => {
    const held = await catchStartLogin(page);
    await app(LOGIN);
    await expect(signIn(page)).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(signIn(page)).toBeFocused();
    const ring = await signIn(page).evaluate((b) => getComputedStyle(b).outlineStyle);
    expect(ring).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect.poll(held.url).toBe(`${START_LOGIN}?returnTo=%2F`);
  });

  test('раскладка: без горизонтальной прокрутки, «Войти» ≥ 44 px, axe', async ({
    app,
    page,
    axe,
  }) => {
    await app(`${LOGIN}?error=session_expired`);
    await expect(signIn(page)).toBeVisible();
    expect(await overflowX(page)).toBeLessThanOrEqual(0);
    const box = await signIn(page).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(serious(await axe(page))).toEqual([]);
  });
});

test.describe('auth-login — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('экран входа без запросов; «Войти» ведёт на BFF startLogin стенда', async ({
    app,
    page,
  }) => {
    const api: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/api/')) api.push(u.pathname + u.search);
    });
    await app(`${LOGIN}?next=${encodeURIComponent('/t/x/home')}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Вход' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(api).toEqual([]);
    // На стенде этапа 1 провайдер — dev (AUTH_PROVIDER=dev, план v2 §3.6): startLogin без OIDC отвечает
    // 503 dependency_unavailable (отчёт W1.03); OIDC и Keycloak проверяет smoke интегратора.
    const nav = page.waitForResponse((r) => new URL(r.url()).pathname === START_LOGIN);
    await signIn(page).click();
    const res = await nav;
    expect(new URL(res.url()).search).toBe('?returnTo=%2Ft%2Fx%2Fhome');
    expect([302, 503]).toContain(res.status());
  });

  test('«Выйти» владельца → экран «Вход», запросов после logout нет', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    await expect(page).toHaveURL(/\/t\/[0-9a-f-]{36}\/home$/, { timeout: 15_000 });
    // Запросы оболочки после входа (сводка, билет канала) — до начала журнала.
    await page.waitForLoadState('networkidle');
    const seen: string[] = [];
    page.on('response', (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/api/')) seen.push(`${r.status()} ${u.pathname}`);
    });
    await page.getByRole('banner').getByRole('button', { name: 'Профиль' }).click();
    await page
      .getByRole('dialog', { name: 'Профиль' })
      .getByRole('button', { name: 'Выйти' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Вход' })).toBeVisible();
    await expect(signIn(page)).toBeEnabled();
    await page.waitForLoadState('networkidle');
    expect(seen).toEqual(['200 /api/v1/auth/logout']);
  });
});
