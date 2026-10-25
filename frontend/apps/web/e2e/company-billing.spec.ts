// W4.61 · e2e страницы `company-billing` — «Подписка и места» владельца (эталон design-2026-10-19, «Ортус CRM.dc.html»
// pg.billing :1454–1528, billingVM :3916–3957; чек-лист docs/plan/analysis/02-company.md §10 п. 37–47, обязательные
// пункты verification-protocol.md §1.3). Данные — getTenantSubscription, getTenantPriceBook,
// listSubscriptionChangeRequests и listMembers сценарного сервера.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './fixtures/index.ts';
import {
  billingSection,
  cancelOwnPendingRequests,
  mskLastDayText,
  ownerChangeRequests,
  readInbox,
  realClock,
  releaseStandLocks,
  STAND_LOCK,
  standLock,
  standMark,
  textOf,
  toastText,
} from './billing.helpers.ts';
import { hitHeight, noHorizontalScroll, openPage } from './modules.helpers.ts';
import { call, devScenario, LOTOS, tenantId } from './shell.helpers.ts';

const H1 = { level: 1, name: 'Подписка и места' } as const;
const INTRO =
  'Лицензия действует на весь бизнес: все регионы и фирмы. Место занимает каждый, у кого есть вход в приложение.';

const terms = (root: Locator) => root.getByRole('radiogroup', { name: 'Срок оплаты' });
const tiers = (root: Locator) => root.getByRole('radiogroup', { name: 'Тариф' });
const tier = (root: Locator, name: string) =>
  tiers(root)
    .getByRole('radio')
    .filter({ has: root.page().locator('strong', { hasText: name }) });
const send = (root: Locator) => root.getByRole('button', { name: 'Отправить заявку оператору' });
const paidList = (root: Locator) => root.locator('.ox-bl-paid');
const freeList = (root: Locator) => root.locator('.ox-bl-free');

async function openBilling(
  app: Parameters<typeof openPage>[0],
  page: Page,
  o: { persona?: 'owner' | 'owner@t-lotos'; tenant?: string } = {},
): Promise<{ root: Locator; tenantId: string }> {
  const tenantId = await openPage(app, page, 'billing', o);
  await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
  const root = billingSection(page);
  await expect(root.getByRole('status', { name: 'Загрузка' })).toHaveCount(0, { timeout: 15_000 });
  return { root, tenantId };
}

test.describe('company-billing — «Подписка и места» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'данные сида MSW и сценарии — режим mock');
  // Под нагрузкой общей машины вход и холодная загрузка страницы занимают до 30 с.
  test.describe.configure({ timeout: 60_000 });

  test('меню «Подписка и места» и прямой URL: крошка, заголовок, описание, data-screen-label', async ({
    app,
    page,
  }) => {
    const id = await openPage(app, page, 'modules');
    await page.setViewportSize({ width: 1440, height: 900 });
    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    await nav.getByRole('button', { name: 'Подписка и места' }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${id}/billing$`));
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
    const root = billingSection(page);
    await expect(root).toHaveAttribute('data-screen-label', 'Владелец · подписка и места');
    await expect(root).toContainText('Альта Групп / Компания');
    await expect(root.getByText(INTRO)).toBeVisible();
  });

  test('пробный период «Альты»: тариф, чип, места и подпись (02 §10 п. 37)', async ({
    app,
    page,
  }) => {
    const { root } = await openBilling(app, page);
    await expect(
      root.getByRole('heading', { level: 2, name: 'Пробный период · «Старт»' }),
    ).toBeVisible();
    await expect(root.locator('.ox-bl-plan .ox-chip-label')).toHaveText(
      'до 13.10.2026 · осталось 12 дн.',
    );
    await expect(
      root.getByText(
        'В пробном периоде до 10 мест и все подключённые модули. Чтобы продолжить после него, выберите тариф ниже.',
      ),
    ).toBeVisible();
    await expect(root.locator('.ox-bl-seats-value')).toHaveText('9 из 10');
    await expect(root.getByText('7 активны · 2 приглашения · 1 свободно')).toBeVisible();
    await expect(root.locator('.ox-bl-bar .ox-pk-bar-fill')).toHaveCSS(
      'background-color',
      'rgb(183, 121, 31)',
    );
  });

  test('сроки и тарифы: «12 мес −20%», пять карточек, подсказка «Выберите тариф» (02 §10 п. 38)', async ({
    app,
    page,
  }) => {
    const { root } = await openBilling(app, page);
    await expect(terms(root).getByRole('radio')).toHaveText([
      'Месяц',
      '4 мес−5%',
      '8 мес−10%',
      '12 мес−20%',
    ]);
    await expect(terms(root).getByRole('radio', { name: /^12 мес\s?−20%$/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(tiers(root).getByRole('radio')).toHaveCount(5);
    expect(await textOf(tier(root, 'Старт'))).toBe(
      'Старт до 10 мест 3 120 ₽ в месяц 37 440 ₽ за 12 мес Тот же лимит, что в пробном периоде',
    );
    expect(await textOf(tier(root, 'Безлимит'))).toBe(
      'Безлимит больше 100 мест Индивидуально расчёт с оператором',
    );
    await expect(root.getByText('Выберите тариф', { exact: true })).toBeVisible();
    await expect(send(root)).toBeDisabled();
  });

  test('«Месяц»: цена без скидки, без строки «за 12 мес» (02 §10 п. 39)', async ({ app, page }) => {
    const { root } = await openBilling(app, page);
    await terms(root).getByRole('radio', { name: 'Месяц' }).click();
    expect(await textOf(tier(root, 'Старт'))).toBe(
      'Старт до 10 мест 3 900 ₽ в месяц Тот же лимит, что в пробном периоде',
    );
  });

  test('выбор «Команда» на 12 мес: расчёт и экономия, отправка доступна (02 §10 п. 40)', async ({
    app,
    page,
  }) => {
    const { root } = await openBilling(app, page);
    await tier(root, 'Команда').click();
    await expect(tier(root, 'Команда')).toHaveAttribute('aria-checked', 'true');
    const calc = root.locator('.ox-bl-calc');
    expect(await textOf(calc)).toBe(
      '7 120 ₽ в месяц · 85 440 ₽ за 12 месЭкономия 21 360 ₽ по сравнению с помесячной оплатой. Новый лимит: 25 мест.',
    );
    await expect(send(root)).toBeEnabled();
  });

  test('заявка: тост, баннер с «Отменить заявку», тарифы недоступны; отмена (02 §10 п. 41–42)', async ({
    app,
    page,
  }) => {
    const { root } = await openBilling(app, page);
    await tier(root, 'Команда').click();
    await root.getByLabel('Комментарий для оператора').fill('Подключаем ещё две фирмы');
    await send(root).click();
    await expect(toastText(page)).toHaveText('Заявка отправлена оператору');
    const banner = root.getByRole('status').filter({ hasText: 'отправлена' });
    await expect(banner).toContainText(
      /^pendingЗаявка SR-\d+ на «Команда» · 12 мес отправлена \d\d\.\d\d \d\d:\d\d\. Новый лимит начнёт действовать после подтверждения оператором\.Отменить заявку$/,
    );
    for (const r of await tiers(root).getByRole('radio').all()) {
      await expect(r).toHaveAttribute('aria-disabled', 'true');
    }
    await expect(
      root.getByText('Сначала дождитесь решения по текущей заявке или отмените её'),
    ).toBeVisible();
    await expect(root.getByLabel('Комментарий для оператора')).toHaveValue('');
    await banner.getByRole('button', { name: 'Отменить заявку' }).click();
    await expect(toastText(page)).toHaveText('Заявка отменена');
    await expect(root.getByRole('status').filter({ hasText: 'отправлена' })).toHaveCount(0);
    await expect(tier(root, 'Команда')).toHaveAttribute('aria-disabled', 'false');
  });

  test('списки «Занимают место · 9» и «Не занимают место · 1» (02 §10 п. 43)', async ({
    app,
    page,
  }) => {
    const { root } = await openBilling(app, page);
    await expect(paidList(root).getByRole('heading', { level: 2 })).toHaveText(
      'Занимают место · 9',
    );
    const rows = paidList(root).locator('.ox-bl-person');
    await expect(rows).toHaveCount(9);
    for (let i = 0; i < 7; i++)
      await expect(rows.nth(i).locator('.ox-chip-label')).toHaveText('Активен');
    await expect(rows.nth(7)).toContainText('Олеся Петрова');
    await expect(rows.nth(7).locator('.ox-chip-label')).toHaveText('Приглашён');
    await expect(rows.nth(7)).toContainText('Приглашение отправлено · место зарезервировано');
    await expect(rows.nth(8)).toContainText('Сергей Ильин');
    await expect(freeList(root).getByRole('heading', { level: 2 })).toHaveText(
      'Не занимают место · 1',
    );
    await expect(freeList(root)).toContainText('Заблокированные и карточки без входа');
    await expect(freeList(root).locator('.ox-bl-person').first()).toContainText(
      'Кирилл ГромовВодитель · заблокирован, история сохранена',
    );
  });

  test('мест нет (10 из 10): статус «Мест нет…» и красная полоса (02 §10 п. 45)', async ({
    app,
    page,
  }) => {
    const { tenantId } = await openBilling(app, page);
    const units = (await call(page, 'GET', `/api/v1/tenants/${tenantId}/org-units?limit=200`))
      .body as { items: { id: string }[] };
    const r = await call(page, 'POST', `/api/v1/tenants/${tenantId}/invitations`, {
      body: {
        email: 'new.person@alta.example',
        displayName: 'Новый сотрудник',
        orgUnitIds: [units.items[0]?.id],
        roleAssignments: [],
      },
    });
    expect(r.status).toBe(201);
    await page.reload();
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
    const root = billingSection(page);
    await expect(root.locator('.ox-bl-seats-value')).toHaveText('10 из 10', { timeout: 15_000 });
    await expect(
      root.getByRole('status').filter({
        hasText: 'Мест нет: новые приглашения закрыты. Сотрудники с доступом продолжают работать.',
      }),
    ).toBeVisible();
    await expect(root.locator('.ox-bl-bar .ox-pk-bar-fill')).toHaveCSS(
      'background-color',
      'rgb(161, 58, 51)',
    );
  });

  test('«Пригласить» открывает «Пользователи и роли» с диалогом приглашения (02 §10 п. 46)', async ({
    app,
    page,
  }) => {
    const { root, tenantId } = await openBilling(app, page);
    await paidList(root).getByRole('button', { name: 'Пригласить' }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenantId}/users\\?tab=people&invite=1$`));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Пользователи и роли' }),
    ).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Пригласить участника' })).toBeVisible();
  });

  test('владелец «Лотоса»: оплаченный тариф, заявка SR-12 на рассмотрении, тарифы недоступны (02 §10 п. 47)', async ({
    app,
    page,
  }) => {
    const { root } = await openBilling(app, page, { persona: 'owner@t-lotos', tenant: LOTOS });
    await expect(root.getByRole('heading', { level: 2, name: 'Тариф «Команда»' })).toBeVisible();
    await expect(root.locator('.ox-bl-plan .ox-chip-label')).toHaveText('Оплачено до 31.03.2027');
    await expect(
      root.getByText('Оплата за 12 мес · цены версии v1 сохраняются до конца периода'),
    ).toBeVisible();
    await expect(root.locator('.ox-bl-seats-value')).toHaveText('23 из 25');
    await expect(root.getByRole('status').filter({ hasText: 'SR-12' })).toContainText(
      'Заявка SR-12 на «Бизнес» · 12 мес отправлена 29.09 16:40. Новый лимит начнёт действовать после подтверждения оператором.',
    );
    await expect(tier(root, 'Команда')).toContainText('Текущий тариф');
    await expect(tier(root, 'Старт')).toContainText('Занято 23 — не поместится');
    for (const r of await tiers(root).getByRole('radio').all()) {
      await expect(r).toHaveAttribute('aria-disabled', 'true');
    }
  });

  test('отклонённая заявка: баннер «Заявка SR-12 отклонена оператором: …»', async ({
    app,
    page,
  }) => {
    await openBilling(app, page, { persona: 'owner@t-lotos', tenant: LOTOS });
    await app('/platform/requests', { persona: 'operator' });
    const reqs = (await call(page, 'GET', '/api/v1/platform/subscription-requests?status=pending'))
      .body as { items: { id: string; number: string }[] };
    const sr12 = reqs.items.find((x) => x.number === 'SR-12');
    const r = await call(
      page,
      'POST',
      `/api/v1/platform/subscription-requests/${sr12?.id}/decision`,
      {
        body: { decision: 'reject', note: 'Нет оплаты' },
      },
    );
    expect(r.status).toBe(200);
    const { root } = await openBilling(app, page, { persona: 'owner@t-lotos', tenant: LOTOS });
    await expect(
      root.getByRole('status').filter({ hasText: 'Заявка SR-12 отклонена оператором: Нет оплаты' }),
    ).toBeVisible();
    await expect(tier(root, 'Бизнес')).toHaveAttribute('aria-disabled', 'false');
  });

  test('запланированная версия сетки: баннер «С 01.11.2026 меняются цены тарифов…»', async ({
    app,
    page,
  }) => {
    await app('/platform/plans', { persona: 'operator' });
    const list = (await call(page, 'GET', '/api/v1/platform/price-book/versions')).body as {
      items: { state: string; tiers: unknown[]; terms: unknown[] }[];
    };
    const cur = list.items.find((v) => v.state === 'current');
    const r = await call(page, 'POST', '/api/v1/platform/price-book/versions', {
      body: { effectiveFrom: '2026-11-01', note: 'Тест', tiers: cur?.tiers, terms: cur?.terms },
    });
    expect(r.status).toBe(201);
    const { root } = await openBilling(app, page);
    await expect(
      root.getByRole('status').filter({
        hasText:
          'С 01.11.2026 меняются цены тарифов. Заявки, поданные до этой даты, считаются по текущим ценам; оплаченный период не пересчитывается.',
      }),
    ).toBeVisible();
  });

  test('заявка уже на рассмотрении (409): тост «Заявка уже на рассмотрении…»', async ({
    app,
    page,
  }) => {
    const { root } = await openBilling(app, page);
    await tier(root, 'Команда').click();
    await devScenario(page, {
      scenario: 'createSubscriptionChangeRequest=request_pending',
      once: true,
    });
    await send(root).click();
    await expect(toastText(page)).toHaveText(
      'Заявка уже на рассмотрении. Отмените её, чтобы отправить новую.',
    );
  });

  test('нет связи при отправке: тост warn, выбор сохраняется', async ({ app, page }) => {
    const { root } = await openBilling(app, page);
    await tier(root, 'Команда').click();
    await devScenario(page, { scenario: 'createSubscriptionChangeRequest=offline', once: true });
    await send(root).click();
    await expect(toastText(page)).toHaveText('Нет связи с сервером. Операция не выполнена.');
    await expect(tier(root, 'Команда')).toHaveAttribute('aria-checked', 'true');
  });

  test('ошибка чтения: alert и «Повторить» (no-reference)', async ({ app, page }) => {
    await openBilling(app, page);
    await devScenario(page, { scenario: 'getTenantPriceBook=rate_limited', once: true });
    await page.reload();
    // Возврат 1: после reload оболочка под нагрузкой грузится дольше 5 с ожидания по умолчанию.
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
    const alert = billingSection(page).getByRole('alert');
    await expect(alert).toContainText('Не удалось загрузить подписку: Слишком много запросов', {
      timeout: 15_000,
    });
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(tiers(billingSection(page)).getByRole('radio')).toHaveCount(5);
  });

  // Возврат 1: скелетон проверяется явно (раньше название теста его обещало), офлайн-чтение — отдельно.
  test('загрузка: скелетон «Загрузка» до ответа getTenantSubscription (no-reference)', async ({
    app,
    page,
  }) => {
    await openBilling(app, page);
    await devScenario(page, { scenario: 'getTenantSubscription=delay=2500' });
    await page.reload();
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
    const root = billingSection(page);
    const status = root.getByRole('status', { name: 'Загрузка' });
    await expect(status).toBeVisible();
    await expect(tiers(root).getByRole('radio')).toHaveCount(5, { timeout: 15_000 });
    await expect(status).toHaveCount(0);
    await devScenario(page, { scenario: null });
  });

  test('нет связи при чтении: alert «Нет связи с сервером…» и «Повторить» (no-reference)', async ({
    app,
    page,
  }) => {
    await openBilling(app, page);
    await devScenario(page, { scenario: 'getTenantSubscription=offline' });
    await page.reload();
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
    const alert = billingSection(page).getByRole('alert');
    await expect(alert).toContainText('Нет связи с сервером. Проверьте подключение.', {
      timeout: 15_000,
    });
    await devScenario(page, { scenario: null });
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(tiers(billingSection(page)).getByRole('radio')).toHaveCount(5);
  });

  test('сотрудник без права billing.read: раздела нет в меню, прямой URL — AccessGate', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'billing', { persona: 'manager' });
    await expect(page.locator('.ox-gate')).toBeVisible({ timeout: 15_000 });
    await expect(billingSection(page)).toHaveCount(0);
  });

  test('390: без горизонтальной прокрутки, карточки в столбец, цели ≥ 44 px', async ({
    app,
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { root } = await openBilling(app, page);
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(
      await hitHeight(terms(root).getByRole('radio', { name: 'Месяц' })),
    ).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(tier(root, 'Команда'))).toBeGreaterThanOrEqual(44);
    // Возврат 1 (ревью, minor): «Пригласить» в шапке «Занимают место · N» — 40 px эталона, область нажатия 44 px.
    expect(
      await hitHeight(root.getByRole('button', { name: 'Пригласить' })),
    ).toBeGreaterThanOrEqual(44);
    const plan = await root.locator('.ox-bl-plan').boundingBox();
    const seats = await root.locator('.ox-bl-seats').boundingBox();
    expect(plan && seats && seats.y > plan.y, 'места под тарифом').toBe(true);
  });

  test('клавиатура: Tab по срокам и тарифам, Enter выбирает', async ({ app, page }) => {
    const { root } = await openBilling(app, page);
    await terms(root).getByRole('radio', { name: 'Месяц' }).focus();
    await page.keyboard.press('Enter');
    await expect(terms(root).getByRole('radio', { name: 'Месяц' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await tier(root, 'Команда').focus();
    await page.keyboard.press('Enter');
    await expect(tier(root, 'Команда')).toHaveAttribute('aria-checked', 'true');
  });

  test('axe: нет нарушений serious/critical', async ({ app, page, axe }) => {
    await openBilling(app, page);
    const r = await axe(page);
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
  });
});

// W4.71 (Q-W4.61-20): ожидания — Go-сид шага 4.6 (backend/cmd/seed/billing.go, subscriptions.go): «Альта» — пробный
// «Старт» v2, сетка v2 — пять тарифов и сроки 1/4/8/12 мес. Даты подписки сид сдвигает к дню прогона, а места и
// срок пробного меняют другие строки полного прогона, поэтому они сверяются с ответом getTenantSubscription. Заявка —
// своя на прогон: хвост прошлой попытки строк W4.71 (метка STAND_MARK) отменяется, чужие открытые заявки не трогаются,
// своя отменяется из баннера, уведомления владельца читаются.

/** Приглашение без участия control DB в ответе listMembers (строка возврата 2). */
const INVITE_ONLY = 'Приглашение без участия W4.71';

/**
 * Плитка «Места» и список «Занимают место» стенда — по ответам, которые читает страница: плитка — seats подписки
 * (участия control DB), список — listMembers (billingVM: активные с входом, затем приглашённые, и приглашения без
 * участия W1.52). Числа расходятся, когда на стенде есть приглашение без участия (Q-W4.71-4).
 */
async function expectSeats(page: Page, root: Locator, id: string): Promise<void> {
  const sub = (await call(page, 'GET', `/api/v1/tenants/${id}/subscription`)).body as {
    seats: { used: number; limit: number };
  };
  const members = (await call(page, 'GET', `/api/v1/tenants/${id}/members?limit=200`)).body as {
    items: { displayName: string; status: string; userId?: string }[];
  };
  const paid = [
    ...members.items.filter((m) => m.status === 'active' && m.userId !== undefined),
    ...members.items.filter((m) => m.status === 'invited'),
  ].map((m) => m.displayName);
  await expect(root.locator('.ox-bl-seats-value')).toHaveText(
    `${sub.seats.used} из ${sub.seats.limit}`,
  );
  await expect(paidList(root).getByRole('heading', { level: 2 })).toHaveText(
    `Занимают место · ${paid.length}`,
  );
  const people = paidList(root).locator('.ox-bl-person');
  await expect(people).toHaveCount(paid.length);
  for (const [i, name] of paid.entries()) await expect(people.nth(i)).toContainText(name);
  await expect(paidList(root)).toContainText('Дарья Зимина');
}

test.describe('company-billing — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  test.describe.configure({ timeout: 90_000 });
  test.afterEach(releaseStandLocks);

  test('владелец стенда: подписка, места и заявка оператору', async ({ app, page }) => {
    // Одна открытая заявка на организацию: строки с заявками «Альты» идут по очереди и в параллельном прогоне.
    await standLock(STAND_LOCK.altaRequests);
    await realClock(page);
    await app('/', { persona: 'owner' });
    const id = await tenantId(page);
    await cancelOwnPendingRequests(page, id);
    const { root } = await openBilling(app, page);
    const sub = (await call(page, 'GET', `/api/v1/tenants/${id}/subscription`)).body as {
      trialEndsAt: string;
    };
    await expect(root).toHaveAttribute('data-screen-label', 'Владелец · подписка и места');
    await expect(root).toContainText('Альта Групп / Компания');
    await expect(
      root.getByRole('heading', { level: 2, name: 'Пробный период · «Старт»' }),
    ).toBeVisible();
    await expect(root.locator('.ox-bl-plan .ox-chip-label')).toHaveText(
      new RegExp(
        `^до ${mskLastDayText(sub.trialEndsAt).replaceAll('.', '\\.')} · осталось \\d+ дн\\.$`,
      ),
    );
    await expectSeats(page, root, id);

    // Сетка v2 сида: сроки со скидками и пять тарифов, расчёт «Команды» на 12 мес.
    await expect(terms(root).getByRole('radio')).toHaveText([
      'Месяц',
      '4 мес−5%',
      '8 мес−10%',
      '12 мес−20%',
    ]);
    await expect(tiers(root).getByRole('radio')).toHaveCount(5);
    expect(await textOf(tier(root, 'Старт'))).toBe(
      'Старт до 10 мест 3 120 ₽ в месяц 37 440 ₽ за 12 мес Тот же лимит, что в пробном периоде',
    );
    expect(await textOf(tier(root, 'Сеть'))).toBe(
      'Сеть до 100 мест 22 320 ₽ в месяц 267 840 ₽ за 12 мес',
    );
    expect(await textOf(tier(root, 'Безлимит'))).toBe(
      'Безлимит больше 100 мест Индивидуально расчёт с оператором',
    );
    await expect(send(root)).toBeDisabled();
    await tier(root, 'Команда').click();
    expect(await textOf(root.locator('.ox-bl-calc'))).toBe(
      '7 120 ₽ в месяц · 85 440 ₽ за 12 месЭкономия 21 360 ₽ по сравнению с помесячной оплатой. Новый лимит: 25 мест.',
    );

    // Заявка оператору: баннер с номером сервера, тарифы закрыты; отмена из баннера возвращает данные.
    const comment = standMark(test.info().project.name);
    await root.getByLabel('Комментарий для оператора').fill(comment);
    await send(root).click();
    await expect(toastText(page)).toHaveText('Заявка отправлена оператору');
    const mine = (await ownerChangeRequests(page, id)).find((x) => x.comment === comment);
    expect(mine?.status).toBe('pending');
    const banner = root.getByRole('status').filter({ hasText: 'отправлена' });
    await expect(banner).toContainText(
      new RegExp(
        `^pendingЗаявка ${mine?.number} на «Команда» · 12 мес отправлена \\d\\d\\.\\d\\d \\d\\d:\\d\\d\\. Новый лимит начнёт действовать после подтверждения оператором\\.Отменить заявку$`,
      ),
    );
    for (const r of await tiers(root).getByRole('radio').all()) {
      await expect(r).toHaveAttribute('aria-disabled', 'true');
    }
    await expect(
      root.getByText('Сначала дождитесь решения по текущей заявке или отмените её'),
    ).toBeVisible();
    await banner.getByRole('button', { name: 'Отменить заявку' }).click();
    await expect(toastText(page)).toHaveText('Заявка отменена');
    await expect(root.getByRole('status').filter({ hasText: 'отправлена' })).toHaveCount(0);
    await expect(tier(root, 'Команда')).toHaveAttribute('aria-disabled', 'false');
    expect((await ownerChangeRequests(page, id)).find((x) => x.id === mine?.id)?.status).toBe(
      'cancelled',
    );
    await readInbox(page, id);
  });

  test('владелец стенда: приглашение без участия — в «Занимают место», плитка мест — по подписке', async ({
    app,
    page,
  }) => {
    // Возврат 2 (полный e2e-stand): путь владельца этапа 1 (journeys/stage1/owner-onboarding @stand) идёт раньше и
    // оставляет приглашение «Новый Сотрудник» без участия control DB (W1.52). listMembers отдаёт его «Приглашён», и
    // страница ставит его в «Занимают место» (billingVM), а места подписки (tenant_seat_usage) считают только участия.
    // Состояние стенда после той строки — ответ listMembers с таким приглашением, без правки данных.
    await app('/', { persona: 'owner' });
    const id = await tenantId(page);
    await page.route(
      (url) => url.pathname === `/api/v1/tenants/${id}/members`,
      async (route) => {
        const r = await route.fetch();
        const body = (await r.json()) as { items: Record<string, unknown>[] };
        body.items.push({
          id: crypto.randomUUID(),
          displayName: INVITE_ONLY,
          email: 'invite-only.w471@alta.example',
          orgUnitIds: [],
          revision: 1,
          status: 'invited',
          workProfiles: [],
        });
        await route.fulfill({ response: r, json: body });
      },
    );
    const { root } = await openBilling(app, page);
    await expectSeats(page, root, id);
    await expect(paidList(root)).toContainText(INVITE_ONLY);
  });
});
