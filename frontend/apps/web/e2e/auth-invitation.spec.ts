// W1.22 · e2e страницы `auth-invitation` — принятие приглашения по ссылке письма `/auth/invitation#token=…`
// (S1-06, no-reference до B-6 №2; ссылка — W1.41, Q-W1.41-3; бриф docs/plan/v2/ws/W1.22.md §5). Режим mock: приглашение
// сида Олеси Петровой (acc-6) и сценарии сценарного сервера; stand: inspectInvitation стенда; @mailpit — сквозное
// принятие по письму на стенде с Mailpit (W1.41) и dev-входом нового человека (W1.50).
import { newcomer } from '@ortus/e2e-kit';
import type { Page } from '@playwright/test';

import {
  devLoginAs,
  fakeIdp,
  INVITATION_PATH,
  invitationLink,
  mailpitToken,
  overflowX,
  PETROVA,
  seedToken,
  serious,
  setSeedInvitationsStatus,
  START_LOGIN,
} from './auth.helpers.ts';
import { expect, test } from './fixtures/index.ts';
import { ALTA, call, devScenario, LOTOS, tenantId } from './shell.helpers.ts';

const main = (page: Page) => page.getByRole('main');
const title = (page: Page) => page.getByRole('heading', { level: 1 });
const accept = (page: Page) => page.getByRole('button', { name: 'Принять приглашение' });
const signInAccept = (page: Page) => page.getByRole('button', { name: 'Войти и принять' });

/** Открыть ссылку письма в загруженном приложении (MSW уже работает, если mock). */
async function openLink(page: Page, token: string, persona?: string): Promise<void> {
  const url = new URL(invitationLink(token), 'http://e2e.invalid');
  if (persona) url.searchParams.set('persona', persona);
  await page.goto(url.pathname + url.search + url.hash);
}

/** Страница приложения без входа (MSW запущен) и токен приглашения Олеси Петровой. */
async function petrovaToken(page: Page, app: (route: string) => Promise<unknown>): Promise<string> {
  await app('/auth/login');
  return seedToken(page);
}

test.describe('auth-invitation — приглашение @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сид и сценарии — сценарный сервер mock');

  test('ссылка без входа: бизнес, маска почты, срок, «Войти и принять»; токен убран из адреса', async ({
    app,
    page,
  }) => {
    const token = await petrovaToken(page, app);
    const urls: string[] = [];
    page.on('request', (r) => urls.push(r.url()));
    await openLink(page, token);
    await expect(title(page)).toHaveText(`Приглашение в «${ALTA}»`);
    await expect(main(page)).toContainText(
      `Приглашение отправлено на ${PETROVA.masked} и действует до 8 октября в 10:30.`,
    );
    await expect(main(page)).toContainText(
      'Войдите под этим адресом — после входа вы вернётесь сюда и примете приглашение.',
    );
    await expect(signInAccept(page)).toBeEnabled();
    await expect(page).toHaveURL(new RegExp(`${INVITATION_PATH}$`));
    expect(urls.filter((u) => u.includes(token))).toEqual([]);
    await expect(page.getByRole('banner')).toHaveCount(0);
  });

  test('«Войти и принять» → провайдер (returnTo=/auth/invitation) → вход приглашённой → «Принять приглашение» → «Альта Групп»', async ({
    app,
    page,
  }) => {
    const token = await petrovaToken(page, app);
    const seen = await fakeIdp(page, PETROVA.subject);
    await openLink(page, token);
    await signInAccept(page).click();
    await expect(main(page)).toContainText(`Вы вошли как ${PETROVA.name}.`);
    expect(seen).toEqual([`${START_LOGIN}?returnTo=%2Fauth%2Finvitation`]);
    const done = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/invitations/accept'));
    await accept(page).click();
    expect((await done).status()).toBe(200);
    await expect(page.getByRole('banner')).toContainText(ALTA);
    await expect(
      page.getByRole('status').filter({ hasText: `Вы присоединились к «${ALTA}»` }),
    ).toBeVisible();
    const alta = await tenantId(page);
    await expect(page).toHaveURL(new RegExp(`/t/${alta}/[a-z-]+$`));
    // Ссылка письма повторно — приглашение уже принято, токена в хранилище вкладки нет.
    await openLink(page, token);
    await expect(title(page)).toHaveText('Приглашение уже принято');
    await expect(page.getByRole('link', { name: 'Открыть рабочее пространство' })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('ortus:invitation-token'))).toBeNull();
  });

  test('вошёл другой аккаунт: 403 — «Приглашение для другого адреса», «Войти под другим аккаунтом»', async ({
    app,
    page,
  }) => {
    const token = await petrovaToken(page, app);
    await openLink(page, token, 'owner@t-lotos');
    await expect(main(page)).toContainText('Вы вошли как Ирина Белова.');
    await accept(page).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Приглашение для другого адреса');
    await expect(alert).toContainText(
      `Приглашение отправлено на ${PETROVA.masked}. Войдите под этим адресом.`,
    );
    // Выход и уход к провайдеру (endSessionUrl режима mock — id.example.invalid).
    const left: string[] = [];
    await page.route('https://id.example.invalid/**', async (route) => {
      left.push(new URL(route.request().url()).hostname);
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>logged out</p>' });
    });
    const out = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/logout'));
    await page.getByRole('button', { name: 'Войти под другим аккаунтом' }).click();
    expect((await out).status()).toBe(200);
    await expect.poll(() => left).toEqual(['id.example.invalid']);
  });

  test('срок истёк — «Срок приглашения истёк», кнопок принятия нет', async ({ app, page }) => {
    const token = await petrovaToken(page, app);
    await call(page, 'POST', '/api/v1/dev/scenario', { body: { now: '2026-10-09T00:00:00Z' } });
    await openLink(page, token);
    await expect(title(page)).toHaveText('Срок приглашения истёк');
    await expect(main(page)).toContainText(
      `Попросите владельца «${ALTA}» отправить приглашение ещё раз.`,
    );
    await expect(accept(page)).toHaveCount(0);
    await expect(signInAccept(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Перейти ко входу' })).toBeVisible();
  });

  test('нет мест: acceptInvitation=seats_exhausted — текст и кнопка остаётся', async ({
    app,
    page,
  }) => {
    const token = await petrovaToken(page, app);
    await openLink(page, token, PETROVA.subject);
    await expect(accept(page)).toBeEnabled();
    await devScenario(page, { scenario: 'acceptInvitation=seats_exhausted', once: true });
    await accept(page).click();
    await expect(page.getByRole('alert')).toContainText('Приглашение не принято');
    await expect(page.getByRole('alert')).toContainText(
      'Свободных мест нет. Отзовите приглашение или запросите расширение тарифа.',
    );
    await expect(accept(page)).toBeEnabled();
  });

  test('уже принято или отозвано при принятии: 409 invalid_transition — текст и перепроверка приглашения', async ({
    app,
    page,
  }) => {
    const token = await petrovaToken(page, app);
    await openLink(page, token, PETROVA.subject);
    await expect(accept(page)).toBeEnabled();
    await devScenario(page, { scenario: 'acceptInvitation=invalid_transition', once: true });
    const inspects: number[] = [];
    page.on('response', (r) => {
      if (r.url().endsWith('/api/v1/auth/invitations/inspect')) inspects.push(r.status());
    });
    const done = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/invitations/accept'));
    await accept(page).click();
    expect((await done).status()).toBe(409);
    await expect(page.getByRole('alert')).toContainText('Приглашение не принято');
    await expect(page.getByRole('alert')).toContainText('Приглашение уже принято или отозвано');
    await expect.poll(() => inspects).toEqual([200]);
  });

  test('сессия потеряна до принятия: 401 session_expired — вид «не вошёл», «Войти и принять»', async ({
    app,
    page,
  }) => {
    const token = await petrovaToken(page, app);
    await openLink(page, token, PETROVA.subject);
    await expect(main(page)).toContainText(`Вы вошли как ${PETROVA.name}.`);
    await devScenario(page, { scenario: 'session_expired' });
    const done = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/invitations/accept'));
    await accept(page).click();
    expect((await done).status()).toBe(401);
    await expect(signInAccept(page)).toBeEnabled();
    await expect(main(page)).toContainText(
      'Войдите под этим адресом — после входа вы вернётесь сюда и примете приглашение.',
    );
    await expect(main(page)).not.toContainText('Вы вошли как');
    await expect(accept(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Войти под другим аккаунтом' })).toHaveCount(0);
    await expect(title(page)).toHaveText(`Приглашение в «${ALTA}»`);
  });

  test('отозвано — «Приглашение отозвано», кнопок принятия нет, токен забыт', async ({
    app,
    page,
  }) => {
    const token = await petrovaToken(page, app);
    await setSeedInvitationsStatus(page, 'revoked');
    await openLink(page, token);
    await expect(title(page)).toHaveText('Приглашение отозвано');
    await expect(main(page)).toContainText(
      `Ссылка больше не действует. Если приглашение нужно, обратитесь к владельцу «${ALTA}».`,
    );
    await expect(accept(page)).toHaveCount(0);
    await expect(signInAccept(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Перейти ко входу' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('ortus:invitation-token')))
      .toBeNull();
  });

  test('не найдено: неизвестный токен и ссылка без токена', async ({ app, page }) => {
    await app('/auth/login');
    await openLink(page, 'x'.repeat(43));
    await expect(title(page)).toHaveText('Приглашение не найдено');
    await expect(main(page)).toContainText(
      'Проверьте ссылку из письма — её могли скопировать не полностью — или попросите отправить приглашение ещё раз.',
    );
    const urls: string[] = [];
    page.on('request', (r) => urls.push(new URL(r.url()).pathname));
    await page.evaluate(() => sessionStorage.removeItem('ortus:invitation-token'));
    await page.goto(INVITATION_PATH);
    await expect(title(page)).toHaveText('Приглашение не найдено');
    expect(urls.filter((u) => u.startsWith('/api/v1/auth/invitations'))).toEqual([]);
  });

  test('сбой проверки: inspectInvitation=rate_limited — «Повторить» → приглашение', async ({
    app,
    page,
  }) => {
    const token = await petrovaToken(page, app);
    await devScenario(page, { scenario: 'inspectInvitation=rate_limited', once: true });
    await openLink(page, token);
    await expect(title(page)).toHaveText('Не удалось проверить приглашение');
    await expect(main(page)).toContainText('Слишком много запросов. Подождите и повторите.');
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(title(page)).toHaveText(`Приглашение в «${ALTA}»`);
    // Кнопка «Повторить» исчезла: фокус — на заголовке загруженного приглашения, не на body.
    await expect(title(page)).toBeFocused();
  });

  test('загрузка: inspectInvitation=loading — «Проверяем приглашение…», кнопок нет', async ({
    app,
    page,
  }) => {
    const token = await petrovaToken(page, app);
    await devScenario(page, { scenario: 'inspectInvitation=loading', once: true });
    await openLink(page, token);
    await expect(main(page).getByRole('status')).toHaveText('Проверяем приглашение…');
    await expect(main(page).getByRole('button')).toHaveCount(0);
    await expect(title(page)).toHaveCount(0);
  });

  test('нет связи при проверке: inspectInvitation=offline — текст офлайна, «Повторить» → приглашение', async ({
    app,
    page,
  }) => {
    const token = await petrovaToken(page, app);
    await devScenario(page, { scenario: 'inspectInvitation=offline', once: true });
    await openLink(page, token);
    await expect(title(page)).toHaveText('Не удалось проверить приглашение');
    await expect(main(page)).toContainText('Нет связи с сервером. Операция не выполнена.');
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(title(page)).toHaveText(`Приглашение в «${ALTA}»`);
    await expect(signInAccept(page)).toBeEnabled();
  });

  test('сбой /me/context: приглашение видно, «Не удалось проверить вход», «Повторить» → «Войти и принять»', async ({
    app,
    page,
  }) => {
    const token = await petrovaToken(page, app);
    await devScenario(page, { scenario: 'getMyContext=offline', once: true });
    await openLink(page, token);
    await expect(title(page)).toHaveText(`Приглашение в «${ALTA}»`);
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Не удалось проверить вход');
    await expect(alert).toContainText('Нет связи с сервером. Операция не выполнена.');
    await expect(alert).not.toContainText('Не удалось проверить приглашение');
    const retry = alert.getByRole('button', { name: 'Повторить' });
    if ((page.viewportSize()?.width ?? 0) <= 480) {
      expect((await retry.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await retry.click();
    await expect(signInAccept(page)).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('нет связи при принятии — тост «Нет связи с сервером. Операция не выполнена.»', async ({
    app,
    page,
  }) => {
    // Ответы режима mock даёт service worker, context.setOffline их не обрывает: обрыв — сценарий offline.
    const token = await petrovaToken(page, app);
    await openLink(page, token, PETROVA.subject);
    await expect(accept(page)).toBeEnabled();
    await devScenario(page, { scenario: 'acceptInvitation=offline', once: true });
    await accept(page).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Нет связи с сервером. Операция не выполнена.' }),
    ).toBeVisible();
    await expect(accept(page)).toBeEnabled();
    await expect(title(page)).toHaveText(`Приглашение в «${ALTA}»`);
  });

  test('клавиатура и раскладка: Tab → «Войти и принять», без прокрутки, цели ≥ 44 px, axe', async ({
    app,
    page,
    axe,
  }) => {
    const token = await petrovaToken(page, app);
    await openLink(page, token);
    await expect(signInAccept(page)).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(signInAccept(page)).toBeFocused();
    expect(await overflowX(page)).toBeLessThanOrEqual(0);
    expect((await signInAccept(page).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(serious(await axe(page))).toEqual([]);
  });
});

test.describe('auth-invitation — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('неизвестный токен — inspectInvitation стенда 404 → «Приглашение не найдено»', async ({
    app,
    page,
  }) => {
    await app('/auth/login');
    const inspect = page.waitForResponse((r) =>
      r.url().endsWith('/api/v1/auth/invitations/inspect'),
    );
    await openLink(page, 'A'.repeat(43));
    expect((await inspect).status()).toBe(404);
    await expect(title(page)).toHaveText('Приглашение не найдено');
  });

  test('«Войти и принять» ведёт на BFF startLogin с returnTo=/auth/invitation', async ({
    app,
    page,
  }) => {
    await app('/auth/login');
    // Без живого приглашения (письмо — @mailpit) кнопки нет: проверяется адрес входа экрана «Вход» с next.
    await page.goto(`/auth/login?next=${encodeURIComponent(INVITATION_PATH)}`);
    const nav = page.waitForResponse((r) => new URL(r.url()).pathname === START_LOGIN);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    expect(new URL((await nav).url()).search).toBe('?returnTo=%2Fauth%2Finvitation');
  });
});

// Сквозное принятие по письму: нужен Mailpit стенда (`stand.mjs up postgres mailpit`, SMTP_HOST/SMTP_PORT у cmd/api)
// и `E2E_MAILPIT_URL`. e2e-stand (tools/ci/e2e-stand.mjs) Mailpit пока не поднимает (Q-W1.41-7, W1.30), поэтому
// строка помечена @mailpit, а не @stand.
// Приглашает владелец «SPA «Лотос»»: у «Альты» в сиде свободно одно место из 10, а строка идёт в трёх проектах
// параллельно. Приглашение занимает место сразу; в конце владелец приостанавливает новичка — место освобождается,
// и повторный прогон на том же стенде не упирается в 409 seats_exhausted.
test.describe('auth-invitation — письмо Mailpit @mailpit', () => {
  test.skip(
    ({ harness }) => harness.mode !== 'stand' || !process.env.E2E_MAILPIT_URL,
    'нужен стенд с Mailpit и E2E_MAILPIT_URL',
  );

  test('владелец приглашает → письмо → новичок входит → «Принять приглашение» → «SPA «Лотос»»', async ({
    app,
    page,
  }) => {
    test.slow();
    const mailpit = process.env.E2E_MAILPIT_URL ?? '';
    const email = `w122.${Date.now().toString(36)}.${test.info().project.name}@lotos.example`;
    await app('/', { persona: 'owner@t-lotos' });
    await expect(page).toHaveURL(/\/t\/[0-9a-f-]{36}\/home$/, { timeout: 15_000 });
    const lotos = await tenantId(page, LOTOS);
    // inviteMember требует хотя бы одно подразделение (домашнее подразделение карточки): корень дерева организации.
    const units = await call(page, 'GET', `/api/v1/tenants/${lotos}/org-units`);
    expect(units.status).toBe(200);
    const root = (units.body as { items: { id: string; parentId: string | null }[] }).items.find(
      (u) => u.parentId === null,
    );
    expect(root, 'корневое подразделение «Лотоса»').toBeDefined();
    const invite = await call(page, 'POST', `/api/v1/tenants/${lotos}/invitations`, {
      body: {
        email,
        displayName: 'Тест Приглашения',
        orgUnitIds: [root?.id ?? ''],
        roleAssignments: [],
      },
    });
    expect(invite.status, JSON.stringify(invite.body)).toBe(201);
    const token = await mailpitToken(page, mailpit, email);
    await devLoginAs(page, { ...newcomer(email, 'Тест Приглашения') });
    await openLink(page, token);
    await expect(title(page)).toHaveText(`Приглашение в «${LOTOS}»`);
    await expect(main(page)).toContainText('Вы вошли как Тест Приглашения.');
    await accept(page).click();
    await expect(page.getByRole('banner')).toContainText(LOTOS, { timeout: 15_000 });
    await expect(page).toHaveURL(new RegExp(`/t/${lotos}/`));
    await openLink(page, token);
    await expect(title(page)).toHaveText('Приглашение уже принято');

    // Уборка: владелец приостанавливает новичка (updateMember), место тарифа освобождается.
    await app('/', { persona: 'owner@t-lotos' });
    await expect(page).toHaveURL(/\/t\/[0-9a-f-]{36}\/home$/, { timeout: 15_000 });
    const members = await call(page, 'GET', `/api/v1/tenants/${lotos}/members`);
    expect(members.status).toBe(200);
    const member = (
      members.body as { items: { id: string; email?: string; status: string; revision: number }[] }
    ).items.find((m) => m.email === email);
    expect(member?.status, 'новичок — участник «Лотоса»').toBe('active');
    const suspended = await call(page, 'PATCH', `/api/v1/tenants/${lotos}/members/${member?.id}`, {
      body: { status: 'suspended' },
      ifMatch: `"${member?.revision}"`,
    });
    expect(suspended.status, JSON.stringify(suspended.body)).toBe(200);
  });
});
