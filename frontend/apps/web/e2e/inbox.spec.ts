// W1.22 · e2e страницы `inbox` — панель входящих в слоте шапки оболочки (S1-26, контракт C-7 W1.20; no-reference до
// B-6 №4, подписи поповера «Уведомления» эталона «Ортус CRM.dc.html» :124–135 дословно; бриф
// docs/plan/v2/ws/W1.22.md §5). Режим mock: входящие владельца «Альты» — примеры listMyNotifications/ok; stand —
// входящих на стенде этапа 1 нет (производителей и сида уведомлений нет), проверяется пустая лента.
import type { Page } from '@playwright/test';

import { MOCK_STATE_KEY, overflowX, serious } from './auth.helpers.ts';
import { expect, test } from './fixtures/index.ts';
import { HOME_H1 } from './home.helpers.ts';
import { call, devScenario, tenantId } from './shell.helpers.ts';

const bell = (page: Page) => page.getByRole('banner').getByRole('button', { name: /^Уведомления/ });
const panel = (page: Page) => page.getByRole('dialog', { name: 'Уведомления' });
const items = (page: Page) => panel(page).locator('.ox-inbox-item');

const OWNER_EVENTS = [
  'Олеся Петрова приняла приглашение',
  'Оператор платформы продлил пробный период на 14 дней',
  'Подключён модуль «Салон и SPA»',
];

async function openOwnerPanel(
  page: Page,
  app: (r: string, o: { persona: 'owner' }) => Promise<unknown>,
) {
  await app('/', { persona: 'owner' });
  await expect(page.getByRole('heading', { level: 1, name: HOME_H1 })).toBeVisible();
  await expect(bell(page)).toHaveAccessibleName('Уведомления: 2 новых');
  await bell(page).click();
  // Панель W1.22 грузится лениво (до неё — запасной поповер оболочки без ссылок): ждём строки-ссылки.
  await expect(panel(page).getByRole('link').first()).toBeVisible();
}

/**
 * Ещё 15 прочитанных событий владельца «Альты» — всего 18, две страницы по 12. Правка состояния сценарного сервера
 * вкладки (sessionStorage, только mock) init-скриптом один раз на следующей загрузке, до старта MSW.
 */
async function fifteenMore(page: Page, tenant: string): Promise<void> {
  await page.addInitScript(
    ({ key, alta }) => {
      const done = 'e2e:inbox:fifteen-more';
      const raw = sessionStorage.getItem(key);
      if (sessionStorage.getItem(done) || !raw) return;
      const s = JSON.parse(raw) as {
        accounts: { id: string; proto?: string }[];
        orgs: Record<string, { notifications: Record<string, unknown>[] }>;
      };
      const owner = s.accounts.find((a) => a.proto === 'acc-1');
      const org = s.orgs[alta];
      if (!owner || !org) return;
      for (let i = 0; i < 15; i += 1) {
        org.notifications.push({
          accountId: owner.id,
          id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`,
          kind: 'members.member.updated',
          severity: 'info',
          title: `Событие ${i + 1}`,
          createdAt: `2026-09-2${Math.floor(i / 10)}T0${i % 10}:00:00Z`,
          readAt: '2026-09-29T00:00:00Z',
        });
      }
      sessionStorage.setItem(key, JSON.stringify(s));
      sessionStorage.setItem(done, '1');
    },
    { key: MOCK_STATE_KEY, alta: tenant },
  );
}

/** Панель владельца «Альты» с 18 событиями: первая страница — 12 строк и «Показать ещё». */
async function openOwnerPanelWithMore(
  page: Page,
  app: (r: string, o: { persona: 'owner' }) => Promise<unknown>,
) {
  await app('/', { persona: 'owner' });
  await expect(page.getByRole('heading', { level: 1, name: HOME_H1 })).toBeVisible();
  await fifteenMore(page, await tenantId(page));
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: HOME_H1 })).toBeVisible();
  await expect(bell(page)).toHaveAccessibleName('Уведомления: 2 новых');
  await bell(page).click();
  await expect(panel(page).getByRole('link').first()).toBeVisible();
  await expect(items(page)).toHaveCount(12);
}

const more = (page: Page) => panel(page).getByRole('button', { name: 'Показать ещё' });
const nextPage = (page: Page) =>
  page.waitForResponse((r) => {
    const u = new URL(r.url());
    return u.pathname === '/api/v1/me/notifications' && u.searchParams.has('cursor');
  });

test.describe('inbox — панель входящих @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии — сценарный сервер mock');

  test('владелец: «Уведомления: 2 новых» → события по убыванию, точки непрочитанных, время', async ({
    app,
    page,
  }) => {
    await openOwnerPanel(page, app);
    await expect(panel(page).getByText('Уведомления', { exact: true })).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Прочитать все' })).toBeVisible();
    await expect(items(page).locator('.ox-inbox-text')).toHaveText(OWNER_EVENTS);
    // Время — ЧЧ:ММ, как `{{ n.at }}` поповера эталона (`hhmm()`, ortus/api.js:18); часовой пояс проекта — Москва.
    await expect(items(page).locator('.ox-inbox-at')).toHaveText(['10:12', '09:40', '19:02']);
    await expect(items(page).locator('.ox-inbox-at time').first()).toHaveAttribute(
      'datetime',
      '2026-10-01T07:12:00Z',
    );
    await expect(items(page).nth(0)).toHaveAttribute('data-unread', 'true');
    await expect(items(page).nth(1)).toHaveAttribute('data-unread', 'true');
    await expect(items(page).nth(2)).not.toHaveAttribute('data-unread', 'true');
    await expect(
      panel(page).getByRole('link', { name: `Новое: ${OWNER_EVENTS[0]}` }),
    ).toBeVisible();
    await expect(panel(page)).not.toContainText('Новых событий нет');
  });

  test('переход к записи: событие → «Пользователи и роли», событие прочитано, счётчик 1', async ({
    app,
    page,
  }) => {
    await openOwnerPanel(page, app);
    const alta = await tenantId(page);
    const read = page.waitForResponse((r) => r.url().endsWith('/api/v1/me/notifications/read'));
    await panel(page)
      .getByRole('link', { name: `Новое: ${OWNER_EVENTS[0]}` })
      .click();
    expect((await read).request().postDataJSON()).toEqual({
      tenantId: alta,
      notificationIds: ['e61c0498-0260-549d-b315-ea31d924a5f0'],
    });
    await expect(page).toHaveURL(new RegExp(`/t/${alta}/users$`));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Пользователи и роли' }),
    ).toBeVisible();
    await expect(panel(page)).toBeHidden();
    await expect(bell(page)).toHaveAccessibleName('Уведомления: 1 новых');
    await bell(page).click();
    await expect(items(page).nth(0)).not.toHaveAttribute('data-unread', 'true');
  });

  test('«Прочитать все» → счётчик снят, точек нет, upTo — время последнего события', async ({
    app,
    page,
  }) => {
    await openOwnerPanel(page, app);
    const alta = await tenantId(page);
    const read = page.waitForResponse((r) => r.url().endsWith('/api/v1/me/notifications/read'));
    await panel(page).getByRole('button', { name: 'Прочитать все' }).click();
    expect((await read).request().postDataJSON()).toEqual({
      tenantId: alta,
      upTo: '2026-10-01T07:12:00Z',
    });
    await expect(bell(page)).toHaveAccessibleName('Уведомления');
    await expect(panel(page).locator('.ox-inbox-item[data-unread]')).toHaveCount(0);
    await expect(items(page)).toHaveCount(3);
  });

  test('пусто: водитель — «Новых событий нет», «Прочитать все» без запроса', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'driver' });
    await expect(bell(page)).toHaveAccessibleName('Уведомления');
    await bell(page).click();
    await expect(panel(page)).toContainText('Новых событий нет');
    await expect(items(page)).toHaveCount(0);
    let reads = 0;
    page.on('request', (r) => {
      if (r.url().endsWith('/api/v1/me/notifications/read')) reads += 1;
    });
    await panel(page).getByRole('button', { name: 'Прочитать все' }).click();
    await expect(panel(page)).toContainText('Новых событий нет');
    expect(reads).toBe(0);
  });

  test('загрузка: listMyNotifications=loading — «Загружаем уведомления…»', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    await expect(bell(page)).toHaveAccessibleName('Уведомления: 2 новых');
    await devScenario(page, { scenario: 'listMyNotifications=loading' });
    await bell(page).click();
    await expect(panel(page).getByRole('status')).toHaveText('Загружаем уведомления…');
    await expect(panel(page).getByRole('button', { name: 'Прочитать все' })).toBeVisible();
    await expect(items(page)).toHaveCount(0);
    await expect(panel(page)).not.toContainText('Новых событий нет');
    await devScenario(page, { scenario: null });
  });

  test('сбой ленты: listMyNotifications=rate_limited — текст и «Повторить»', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    await expect(bell(page)).toHaveAccessibleName('Уведомления: 2 новых');
    await devScenario(page, { scenario: 'listMyNotifications=rate_limited' });
    await bell(page).click();
    await expect(panel(page).getByRole('alert')).toContainText('Не удалось загрузить уведомления.');
    await expect(panel(page).getByRole('alert')).toContainText(
      'Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: null });
    await panel(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(items(page)).toHaveCount(3);
  });

  test('нет связи: «Нет связи с сервером. Операция не выполнена.», «Повторить» после связи', async ({
    app,
    page,
  }) => {
    // Ответы режима mock даёт service worker, context.setOffline их не обрывает: обрыв — сценарий offline.
    await app('/', { persona: 'owner' });
    await expect(bell(page)).toHaveAccessibleName('Уведомления: 2 новых');
    await devScenario(page, { scenario: 'listMyNotifications=offline' });
    await bell(page).click();
    await expect(panel(page).getByRole('alert')).toContainText(
      'Нет связи с сервером. Операция не выполнена.',
    );
    await devScenario(page, { scenario: null });
    await panel(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(items(page)).toHaveCount(3);
  });

  test('«Показать ещё»: 18 событий — 12, затем следующая страница по курсору, кнопка исчезает', async ({
    app,
    page,
  }) => {
    await openOwnerPanelWithMore(page, app);
    await expect(more(page)).toBeVisible();
    const next = nextPage(page);
    await more(page).click();
    expect((await next).status()).toBe(200);
    await expect(items(page)).toHaveCount(18);
    await expect(items(page).last().locator('.ox-inbox-text')).toHaveText('Событие 1');
    await expect(more(page)).toHaveCount(0);
  });

  test('сбой догрузки «Показать ещё»: события остаются, текст и «Повторить» догружает', async ({
    app,
    page,
  }) => {
    await openOwnerPanelWithMore(page, app);
    await devScenario(page, { scenario: 'listMyNotifications=rate_limited', once: true });
    const failed = nextPage(page);
    await more(page).click();
    expect((await failed).status()).toBe(429);
    const alert = panel(page).getByRole('alert');
    await expect(alert).toContainText('Не удалось загрузить уведомления.');
    await expect(alert).toContainText('Слишком много запросов. Подождите и повторите.');
    await expect(items(page)).toHaveCount(12);
    await expect(more(page)).toHaveCount(0);
    const next = nextPage(page);
    await alert.getByRole('button', { name: 'Повторить' }).click();
    expect((await next).status()).toBe(200);
    await expect(items(page)).toHaveCount(18);
    await expect(panel(page).getByRole('alert')).toHaveCount(0);
  });

  test('клавиатура: Tab — «Прочитать все», события; Enter открывает запись; Escape закрывает', async ({
    app,
    page,
  }) => {
    await openOwnerPanel(page, app);
    // Порядок эталона: поповер в разметке после «Профиль» — Tab с колокола идёт через «Профиль».
    await page.keyboard.press('Tab');
    await expect(page.getByRole('banner').getByRole('button', { name: 'Профиль' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(panel(page).getByRole('button', { name: 'Прочитать все' })).toBeFocused();
    await page.keyboard.press('Tab');
    const first = panel(page).getByRole('link', { name: `Новое: ${OWNER_EVENTS[0]}` });
    await expect(first).toBeFocused();
    expect(await first.evaluate((a) => getComputedStyle(a).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await bell(page).click();
    await expect(panel(page).getByRole('link').first()).toBeVisible();
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('Tab');
    await expect(first).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/users$/);
  });

  test('раскладка: панель в экране, без прокрутки, цели ≥ 44 px, axe', async ({
    app,
    page,
    axe,
  }) => {
    await openOwnerPanel(page, app);
    const box = await panel(page).boundingBox();
    const vw = page.viewportSize()?.width ?? 0;
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(vw);
    expect(await overflowX(page)).toBeLessThanOrEqual(0);
    for (const target of [
      panel(page).getByRole('button', { name: 'Прочитать все' }),
      panel(page).getByRole('link').first(),
    ]) {
      const hit = await target.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const after = getComputedStyle(el, '::before');
        const extra = after.content !== 'none' ? parseFloat(after.height) || 0 : 0;
        return Math.max(r.height, extra);
      });
      expect(hit).toBeGreaterThanOrEqual(44);
    }
    expect(serious(await axe(page))).toEqual([]);
  });
});

test.describe('inbox — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('владелец стенда: «Уведомления», лента и сводка 200, «Новых событий нет»', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    await expect(page).toHaveURL(/\/t\/[0-9a-f-]{36}\/home$/, { timeout: 15_000 });
    const alta = await tenantId(page);
    const summary = await call(page, 'GET', '/api/v1/me/notifications/summary');
    expect(summary.status).toBe(200);
    const list = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/me/notifications',
    );
    await bell(page).click();
    const res = await list;
    expect(res.status()).toBe(200);
    expect(new URL(res.url()).searchParams.get('tenantId')).toBe(alta);
    await expect(panel(page)).toContainText('Новых событий нет');
    await expect(panel(page).getByRole('button', { name: 'Прочитать все' })).toBeVisible();
  });

  test('массажист двух бизнесов: сводка по обоим, лента — текущего', async ({ app, page }) => {
    await app('/', { persona: 'therapist' });
    await expect(page).toHaveURL(/\/t\/[0-9a-f-]{36}\/spa$/, { timeout: 15_000 });
    const current = new URL(page.url()).pathname.split('/')[2];
    const summary = (await call(page, 'GET', '/api/v1/me/notifications/summary')).body as {
      tenants: { tenantId: string }[];
    };
    expect(summary.tenants.length).toBeGreaterThanOrEqual(2);
    const list = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/me/notifications',
    );
    await bell(page).click();
    expect(new URL((await list).url()).searchParams.get('tenantId')).toBe(current);
    await expect(panel(page)).toContainText('Новых событий нет');
  });
});
