// W1.25 · e2e страницы `platform-org-card` — карточка организации оператора `/platform/tenants?org=<id>` (эталон
// design-stage-1 «Ортус CRM.dc.html» :1554–1580, opConfirm :2176–2201, :2796–2798; чек-лист 04-platform.md §8
// п. 9–14 без квоты и заявки — этап 4; S1-04: причина 5–500 обязательна, Q-W1.00-1…6; журнал — S1-23).
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/index.ts';
import {
  cardValue,
  commandDialog,
  confirmWithReason,
  expectNoHorizontalScroll,
  openOrgs,
  orgCard,
  orgRow,
  type OrgName,
  platformTenantId,
  platformTenants,
} from './platform-orgs.helpers.ts';
import { call, devScenario } from './shell.helpers.ts';

const DONE = 'Готово · запись добавлена в журнал';
const EXTEND = 'Продлить пробный период на 14 дней';
const RESTRICT = 'Ограничить новые операции';
const LIFT = 'Снять ограничение';
const REASON = 'Клиент попросил время на оплату';

const toast = (page: Page) => page.locator('.ox-toast');
const journal = (page: Page) => orgCard(page).locator('.ox-audit-row');

async function openCard(
  app: Parameters<typeof openOrgs>[0],
  page: Page,
  name: OrgName,
): Promise<string> {
  await openOrgs(app, page);
  const id = await platformTenantId(page, name);
  await page.goto(`/platform/tenants?org=${id}`);
  await expect(orgCard(page, name)).toBeVisible();
  return id;
}

test.describe('platform-org-card — карточка организации @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'данные сида MSW и сценарии — режим mock');

  test('«Альта Групп»: заголовок, чип, dl, кнопки продления и «Ограничить…» (04 §8 п. 9)', async ({
    app,
    page,
  }) => {
    await openOrgs(app, page);
    const card = orgCard(page, 'Альта Групп');
    await expect(card.getByRole('heading', { level: 2, name: 'Альта Групп' })).toBeVisible();
    await expect(card.locator('.ox-chip-label').first()).toHaveText('Пробный период');
    await expect(card.locator('dt')).toHaveText([
      'Владелец',
      'Пробный период',
      'Модули',
      'Участники',
      'Место',
      'Тариф',
      'Оплата',
    ]);
    await expect(cardValue(card, 'Владелец')).toHaveText('—');
    await expect(cardValue(card, 'Пробный период')).toHaveText('Осталось 12 дн. · до 13.10.2026');
    await expect(cardValue(card, 'Место')).toHaveText('— из 100 ГБ');
    await expect(cardValue(card, 'Тариф')).toHaveText('«Старт» · пробный · цены v2');
    await expect(cardValue(card, 'Оплата')).toHaveText('Пробный период');
    await expect(card.locator('.ox-org-seats')).toHaveText('— из 10');
    await expect(card.getByRole('button', { name: EXTEND })).toBeVisible();
    await expect(card.getByRole('button', { name: RESTRICT })).toBeVisible();
    await expect(card.getByRole('button', { name: LIFT })).toHaveCount(0);
    await expect(card).toContainText(
      'Изменения не удаляют данные клиента. Цены и юридические условия в прототипе не используются.',
    );
  });

  test('«SPA «Лотос»» оплачена: «Оплачено до 31.03.2027», кнопки продления нет (Q-W1.00-6)', async ({
    app,
    page,
  }) => {
    await openCard(app, page, 'SPA «Лотос»');
    const card = orgCard(page, 'SPA «Лотос»');
    await expect(cardValue(card, 'Оплата')).toHaveText('Оплачено до 31.03.2027');
    await expect(cardValue(card, 'Пробный период')).toHaveText('Не применяется');
    await expect(cardValue(card, 'Тариф')).toHaveText(/^«Команда» · цены v\d$/);
    await expect(card.getByRole('button', { name: EXTEND })).toHaveCount(0);
    await expect(card.getByRole('button', { name: RESTRICT })).toBeVisible();
  });

  test('«Ремстрой Плюс» (read_only после trial): «Завершён 20.09.2026», продление доступно', async ({
    app,
    page,
  }) => {
    await openCard(app, page, 'Ремстрой Плюс');
    const card = orgCard(page, 'Ремстрой Плюс');
    await expect(card.locator('.ox-chip-label').first()).toHaveText('Ограничен');
    await expect(cardValue(card, 'Пробный период')).toHaveText('Завершён 20.09.2026');
    await expect(cardValue(card, 'Оплата')).toHaveText('—');
    await expect(card.getByRole('button', { name: EXTEND })).toBeVisible();
  });

  test('«Карго Сити» по прямому URL: «Приостановлен», «Снять ограничение», без продления', async ({
    app,
    page,
  }) => {
    await openCard(app, page, 'Карго Сити');
    const card = orgCard(page, 'Карго Сити');
    await expect(orgRow(page, 'Карго Сити')).toHaveAttribute('aria-pressed', 'true');
    await expect(card.locator('.ox-chip-label').first()).toHaveText('Приостановлен');
    await expect(card.getByRole('button', { name: LIFT })).toBeVisible();
    await expect(card.getByRole('button', { name: RESTRICT })).toHaveCount(0);
    await expect(card.getByRole('button', { name: EXTEND })).toHaveCount(0);
  });

  test('неизвестный ?org= — карточка первой организации', async ({ app, page }) => {
    await openOrgs(app, page, '/platform/tenants?org=00000000-0000-5000-8000-000000000000');
    await expect(orgCard(page, 'Альта Групп')).toBeVisible();
  });

  test('«Журнал действий»: строки сида дословно, время и автор', async ({ app, page }) => {
    await openOrgs(app, page);
    await expect(
      orgCard(page).getByRole('heading', { level: 3, name: 'Журнал действий' }),
    ).toBeVisible();
    await expect(journal(page)).toHaveCount(2);
    await expect(journal(page).nth(0).locator('.ox-audit-text')).toHaveText(
      'Альта Групп: открыт пробный период на 14 дней, квота 100 ГБ',
    );
    await expect(journal(page).nth(0).locator('.ox-audit-meta')).toHaveText(
      '30.09 18:12 · Е. Лаптева',
    );
    await expect(journal(page).nth(1).locator('.ox-audit-text')).toHaveText(
      'Ремстрой Плюс: пробный период завершён, новые операции ограничены',
    );
    await expect(journal(page).nth(1).locator('.ox-audit-meta')).toHaveText(
      '21.09 09:00 · Система',
    );
  });

  test('«Продлить…»: диалог дословно, «Продлить» недоступна без причины и при < 5 символах', async ({
    app,
    page,
  }) => {
    await openOrgs(app, page);
    await orgCard(page).getByRole('button', { name: EXTEND }).click();
    const dialog = commandDialog(page, 'Продлить пробный период «Альта Групп»?');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Продление на 14 дней.');
    await expect(dialog).toContainText('Последствия');
    await expect(dialog.locator('.ox-orgs-conseq')).toHaveText([
      'Новые операции снова доступны',
      'Действие записывается в журнал',
    ]);
    const confirm = dialog.getByRole('button', { name: 'Продлить', exact: true });
    await expect(dialog.getByRole('button', { name: 'Отмена' })).toBeVisible();
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Причина').fill('    ');
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Причина').fill('Чек');
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Причина').fill('Чек 5');
    await expect(confirm).toBeEnabled();
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await expect(dialog).toBeHidden();
  });

  test('«Продлить…» с причиной: тост, «Осталось 26 дн. · до 27.10.2026», журнал с причиной (04 §8 п. 11)', async ({
    app,
    page,
  }) => {
    await openOrgs(app, page);
    await orgCard(page).getByRole('button', { name: EXTEND }).click();
    const dialog = commandDialog(page, 'Продлить пробный период «Альта Групп»?');
    await confirmWithReason(dialog, 'Продлить', REASON);
    await expect(toast(page)).toContainText(DONE);
    await expect(dialog).toBeHidden();
    await expect(orgRow(page, 'Альта Групп').locator('.ox-org-trial')).toHaveText(
      'Осталось 26 дн. · до 27.10.2026',
    );
    await expect(journal(page).first().locator('.ox-audit-text')).toHaveText(
      'Альта Групп: пробный период продлён на 14 дней',
    );
    await expect(journal(page).first().locator('.ox-audit-reason')).toHaveText(
      `Причина: ${REASON}`,
    );
    await expect(journal(page).first().locator('.ox-audit-meta')).toHaveText(/ · Е\. Лаптева$/);
  });

  test('«Ограничить…» → «Приостановлен» → «Снять ограничение» → «Пробный период» (04 §8 п. 13)', async ({
    app,
    page,
  }) => {
    await openOrgs(app, page);
    const card = orgCard(page, 'Альта Групп');
    await card.getByRole('button', { name: RESTRICT }).click();
    let dialog = commandDialog(page, 'Ограничить «Альта Групп»?');
    await expect(dialog).toContainText('Клиент перейдёт в режим ограниченных операций.');
    await expect(dialog.locator('.ox-orgs-conseq')).toHaveText([
      'Новые брони, рейсы, приглашения и загрузки закрываются',
      'Начатую работу можно завершить',
      'Данные не удаляются',
    ]);
    await confirmWithReason(dialog, 'Ограничить', REASON);
    await expect(toast(page)).toContainText(DONE);
    await expect(card.locator('.ox-chip-label').first()).toHaveText('Приостановлен');
    await expect(orgRow(page, 'Альта Групп').locator('.ox-chip-label')).toHaveText('Приостановлен');
    await expect(card.getByRole('button', { name: RESTRICT })).toHaveCount(0);
    // Кнопки «Ограничить…» больше нет: фокус — на действии, которое её сменило, а не на body.
    await expect(card.getByRole('button', { name: LIFT })).toBeFocused();
    await expect(journal(page).first().locator('.ox-audit-text')).toHaveText(
      'Альта Групп: статус «Приостановлен»',
    );
    await card.getByRole('button', { name: LIFT }).click();
    dialog = commandDialog(page, 'Снять ограничение «Альта Групп»?');
    await expect(dialog).toContainText('Клиент вернётся к действующей подписке.');
    await expect(dialog.locator('.ox-orgs-conseq')).toHaveText(['Новые операции снова доступны']);
    await confirmWithReason(dialog, LIFT, 'Оплата поступила');
    await expect(card.locator('.ox-chip-label').first()).toHaveText('Пробный период');
    await expect(card.getByRole('button', { name: LIFT })).toHaveCount(0);
    await expect(journal(page).first().locator('.ox-audit-text')).toHaveText(
      'Альта Групп: статус «Пробный период»',
    );
  });

  test('«Карго Сити»: «Снять ограничение» возвращает состояние подписки — «Ограничен» (Q-W1.00-3)', async ({
    app,
    page,
  }) => {
    await openCard(app, page, 'Карго Сити');
    const card = orgCard(page, 'Карго Сити');
    await card.getByRole('button', { name: LIFT }).click();
    await confirmWithReason(commandDialog(page, 'Снять ограничение «Карго Сити»?'), LIFT, REASON);
    await expect(toast(page)).toContainText(DONE);
    await expect(card.locator('.ox-chip-label').first()).toHaveText('Ограничен');
  });

  test('конфликт 409: тост ошибки, диалог остаётся открытым', async ({ app, page }) => {
    await openOrgs(app, page);
    await devScenario(page, { scenario: 'suspendPlatformTenant=invalid_transition', once: true });
    await orgCard(page).getByRole('button', { name: RESTRICT }).click();
    const dialog = commandDialog(page, 'Ограничить «Альта Групп»?');
    await confirmWithReason(dialog, 'Ограничить', REASON);
    await expect(toast(page)).toHaveAttribute('role', 'alert');
    await expect(dialog).toBeVisible();
    await expect(orgCard(page).locator('.ox-chip-label').first()).toHaveText('Пробный период');
    // Кнопка действия была недоступна во время запроса: фокус возвращается в диалог, Escape его закрывает.
    await expect(dialog.getByLabel('Причина')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('нет связи: тост «Нет связи с сервером. Операция не выполнена.», диалог открыт', async ({
    app,
    page,
  }) => {
    await openOrgs(app, page);
    await orgCard(page).getByRole('button', { name: EXTEND }).click();
    const dialog = commandDialog(page, 'Продлить пробный период «Альта Групп»?');
    await dialog.getByLabel('Причина').fill(REASON);
    await devScenario(page, { scenario: 'extendPlatformTrial=offline', once: true });
    await dialog.getByRole('button', { name: 'Продлить', exact: true }).click();
    await expect(toast(page)).toContainText('Нет связи с сервером. Операция не выполнена.');
    await expect(toast(page)).toHaveAttribute('data-tone', 'warn');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Причина')).toHaveValue(REASON);
  });

  test('нет связи → повтор: тот же Idempotency-Key, If-Match = ETag подписки, тело {reason, days: 14}', async ({
    app,
    page,
  }) => {
    const etags = new Map<string, string>();
    page.on('response', (r) => {
      const tag = r.headers()['etag'];
      if (r.request().method() === 'GET' && tag) etags.set(new URL(r.url()).pathname, tag);
    });
    await openOrgs(app, page);
    const id = await platformTenantId(page, 'Альта Групп');
    await expect(orgRow(page, 'Альта Групп').locator('.ox-org-trial')).toHaveText(
      'Осталось 12 дн. · до 13.10.2026',
    );
    const subTag = etags.get(`/api/v1/platform/tenants/${id}/subscription`);
    expect(subTag, 'ETag подписки из ответа').toBeTruthy();
    const posts: { key?: string; ifMatch?: string; body: unknown }[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/trial-extensions')) {
        const h = r.headers();
        posts.push({ key: h['idempotency-key'], ifMatch: h['if-match'], body: r.postDataJSON() });
      }
    });
    await orgCard(page).getByRole('button', { name: EXTEND }).click();
    const dialog = commandDialog(page, 'Продлить пробный период «Альта Групп»?');
    await dialog.getByLabel('Причина').fill(`  ${REASON}  `);
    await devScenario(page, { scenario: 'extendPlatformTrial=offline', once: true });
    await dialog.getByRole('button', { name: 'Продлить', exact: true }).click();
    await expect(toast(page)).toContainText('Нет связи с сервером. Операция не выполнена.');
    await expect(dialog.getByLabel('Причина')).toBeFocused();
    await dialog.getByRole('button', { name: 'Продлить', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(orgRow(page, 'Альта Групп').locator('.ox-org-trial')).toHaveText(
      'Осталось 26 дн. · до 27.10.2026',
    );
    expect(posts).toHaveLength(2);
    expect(posts[0]?.key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(posts[1]?.key).toBe(posts[0]?.key);
    expect(posts[0]?.ifMatch).toBe(subTag);
    expect(posts[1]?.ifMatch).toBe(subTag);
    expect(posts[0]?.body).toEqual({ reason: REASON, days: 14 });
  });

  test('412: подписку изменил другой оператор — тост, диалог открыт; повтор после перечитывания — новый ключ и If-Match перечитанной подписки', async ({
    app,
    page,
  }) => {
    await openOrgs(app, page);
    const id = await platformTenantId(page, 'Альта Групп');
    const subPath = `/api/v1/platform/tenants/${id}/subscription`;
    await expect(orgCard(page).getByRole('button', { name: EXTEND })).toBeVisible();
    const shown = (await call(page, 'GET', subPath)).headers['etag'];
    // «Другой оператор» продлевает мимо экрана: ревизия подписки на сервере растёт, экран её не видел.
    const other = await call(page, 'POST', `/api/v1/platform/tenants/${id}/trial-extensions`, {
      body: { reason: 'Продлил другой оператор', days: 14 },
      ifMatch: shown,
    });
    expect(other.status).toBe(200);
    // Перечитывание после 412 идёт не мгновенно: повтор не должен уйти со старым If-Match раньше него.
    await devScenario(page, { scenario: 'getPlatformSubscription=delay=1500' });
    const posts: { key: string; ifMatch: string }[] = [];
    const rereads: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/trial-extensions')) {
        const h = r.headers();
        posts.push({ key: h['idempotency-key'] ?? '', ifMatch: h['if-match'] ?? '' });
      }
    });
    page.on('response', (r) => {
      if (r.request().method() === 'GET' && new URL(r.url()).pathname === subPath && posts.length) {
        rereads.push(r.headers()['etag'] ?? '');
      }
    });
    await orgCard(page).getByRole('button', { name: EXTEND }).click();
    const dialog = commandDialog(page, 'Продлить пробный период «Альта Групп»?');
    await confirmWithReason(dialog, 'Продлить', REASON);
    await expect(toast(page)).toContainText('Данные изменились. Обновите и повторите правку.', {
      timeout: 10_000,
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Продлить', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(toast(page)).toContainText(DONE);
    await devScenario(page, { scenario: null });
    expect(posts).toHaveLength(2);
    expect(posts[0]?.ifMatch).toBe(shown);
    expect(rereads[0], 'ETag перечитанной подписки').toBeTruthy();
    expect(rereads[0]).not.toBe(shown);
    expect(posts[1]?.ifMatch).toBe(rereads[0]);
    expect(posts[1]?.key).not.toBe(posts[0]?.key);
  });

  test('во время запроса фокус остаётся в диалоге: кнопка действия занята (aria-disabled), а не disabled', async ({
    app,
    page,
  }) => {
    await openOrgs(app, page);
    await orgCard(page).getByRole('button', { name: EXTEND }).click();
    const dialog = commandDialog(page, 'Продлить пробный период «Альта Групп»?');
    await dialog.getByLabel('Причина').fill(REASON);
    await devScenario(page, { scenario: 'extendPlatformTrial=delay=2000', once: true });
    await dialog.getByRole('button', { name: 'Продлить', exact: true }).click();
    const busy = dialog.locator('button[aria-busy="true"]');
    await expect(busy).toBeFocused();
    await expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(await busy.evaluate((b) => (b as HTMLButtonElement).disabled), 'не disabled').toBe(
      false,
    );
    expect(
      await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))),
      'фокус в диалоге во время запроса',
    ).toBe(true);
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(toast(page)).toContainText(DONE);
  });

  test('подписка: загрузка — скелетон и «Загрузка», ошибка — alert и «Повторить» (no-reference)', async ({
    app,
    page,
  }) => {
    await openOrgs(app, page);
    await devScenario(page, { scenario: 'getPlatformSubscription=delay=2000' });
    await page.reload();
    const card = orgCard(page, 'Альта Групп');
    await expect(card).toHaveAttribute('aria-busy', 'true');
    // Скелетон без «—»: внутри только скрытое «Загрузка» (возврат доделки №2, axe color-contrast).
    await expect(card.locator('.ox-org-seats')).toHaveText('Загрузка');
    await expect(card.locator('.ox-org-seats')).toHaveAttribute('data-loading', 'true');
    await expect(card).not.toHaveAttribute('aria-busy', 'true', { timeout: 10_000 });
    await expect(card.locator('.ox-org-seats')).toHaveText('— из 10');
    await devScenario(page, { scenario: 'getPlatformSubscription=rate_limited' });
    await page.reload();
    const alert = orgCard(page, 'Альта Групп').getByRole('alert');
    await expect(alert).toContainText('Не удалось загрузить подписку: ');
    await expect(orgCard(page).locator('.ox-org-seats')).toHaveText('—');
    await expect(orgCard(page).getByRole('button', { name: EXTEND })).toHaveCount(0);
    await devScenario(page, { scenario: null });
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(alert).toBeHidden();
    await expect(cardValue(orgCard(page), 'Тариф')).toHaveText('«Старт» · пробный · цены v2');
    await expect(orgCard(page).getByRole('button', { name: EXTEND })).toBeVisible();
  });

  test('организация: ошибка getPlatformTenant — alert, «Ограничить…» недоступна до «Повторить»', async ({
    app,
    page,
  }) => {
    await openOrgs(app, page);
    await devScenario(page, { scenario: 'getPlatformTenant=rate_limited' });
    await page.reload();
    const alert = orgCard(page, 'Альта Групп').getByRole('alert');
    await expect(alert).toContainText('Не удалось загрузить организацию: ');
    await expect(orgCard(page).getByRole('button', { name: RESTRICT })).toBeDisabled();
    await devScenario(page, { scenario: null });
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(alert).toBeHidden();
    await expect(orgCard(page).getByRole('button', { name: RESTRICT })).toBeEnabled();
  });

  test('журнал: пусто — «Действий пока нет», ошибка — alert и «Повторить» (no-reference)', async ({
    app,
    page,
  }) => {
    await openOrgs(app, page);
    await devScenario(page, { scenario: 'listPlatformAuditEvents=empty' });
    await page.reload();
    await expect(orgCard(page, 'Альта Групп').getByText('Действий пока нет')).toBeVisible();
    await expect(journal(page)).toHaveCount(0);
    await devScenario(page, { scenario: 'listPlatformAuditEvents=rate_limited' });
    await page.reload();
    const alert = orgCard(page, 'Альта Групп').getByRole('alert');
    await expect(alert).toContainText('Не удалось загрузить журнал: ');
    await expect(orgCard(page).getByText('Действий пока нет')).toHaveCount(0);
    await devScenario(page, { scenario: null });
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(journal(page)).toHaveCount(2);
  });

  test('причина длиннее 500 символов: «Не больше 500 символов» под полем, действие недоступно', async ({
    app,
    page,
  }) => {
    await openOrgs(app, page);
    await orgCard(page).getByRole('button', { name: RESTRICT }).click();
    const dialog = commandDialog(page, 'Ограничить «Альта Групп»?');
    await dialog.getByLabel('Причина').fill('а'.repeat(501));
    await expect(dialog).toContainText('Не больше 500 символов');
    await expect(dialog.getByLabel('Причина')).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByRole('button', { name: 'Ограничить', exact: true })).toBeDisabled();
    await dialog.getByLabel('Причина').fill('а'.repeat(500));
    await expect(dialog).not.toContainText('Не больше 500 символов');
    await expect(dialog.getByRole('button', { name: 'Ограничить', exact: true })).toBeEnabled();
  });

  test('Escape закрывает диалог, фокус возвращается на кнопку действия', async ({ app, page }) => {
    await openOrgs(app, page);
    const button = orgCard(page).getByRole('button', { name: RESTRICT });
    await button.click();
    const dialog = commandDialog(page, 'Ограничить «Альта Групп»?');
    await expect(dialog.getByLabel('Причина')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
  });

  test('axe: карточка и открытый диалог без serious/critical', async ({ app, page, axe }) => {
    await openOrgs(app, page);
    await orgCard(page).getByRole('button', { name: EXTEND }).click();
    await expect(commandDialog(page, 'Продлить пробный период «Альта Групп»?')).toBeVisible();
    const r = await axe(page);
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
  });

  test('390: карточка под списком, диалог снизу, без горизонтальной прокрутки', async ({
    app,
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openOrgs(app, page);
    await orgCard(page).getByRole('button', { name: EXTEND }).scrollIntoViewIfNeeded();
    await orgCard(page).getByRole('button', { name: EXTEND }).click();
    const dialog = commandDialog(page, 'Продлить пробный период «Альта Групп»?');
    const box = await dialog.boundingBox();
    expect(box && Math.round(box.y + box.height), 'диалог прижат к низу').toBe(844);
    await expectNoHorizontalScroll(page);
  });
});

test.describe('platform-org-card — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('стенд: приостановить и возобновить «Альту» с причиной, журнал с причиной', async ({
    app,
    page,
  }) => {
    // На стенде первая строка — не «Альта» (порядок сервера, Q-W1.25-24): карточка — по ?org=.
    await openCard(app, page, 'Альта Групп');
    const card = orgCard(page, 'Альта Групп');
    await expect(card.locator('.ox-chip-label').first()).toHaveText('Пробный период');
    await card.getByRole('button', { name: RESTRICT }).click();
    await confirmWithReason(commandDialog(page, 'Ограничить «Альта Групп»?'), 'Ограничить', REASON);
    await expect(toast(page)).toContainText(DONE);
    await expect(card.locator('.ox-chip-label').first()).toHaveText('Приостановлен');
    await expect(journal(page).first().locator('.ox-audit-reason')).toHaveText(
      `Причина: ${REASON}`,
    );
    await card.getByRole('button', { name: LIFT }).click();
    await confirmWithReason(commandDialog(page, 'Снять ограничение «Альта Групп»?'), LIFT, REASON);
    await expect(card.locator('.ox-chip-label').first()).toHaveText('Пробный период');
    expect((await platformTenants(page)).get('Альта Групп')?.status).toBe('trial');
  });

  test('стенд: продлить пробный период «Альты» на 14 дней от текущего срока', async ({
    app,
    page,
  }) => {
    const id = await openCard(app, page, 'Альта Групп');
    const trialEnd = async () =>
      Date.parse(
        (
          (await call(page, 'GET', `/api/v1/platform/tenants/${id}/subscription`)).body as {
            trialEndsAt: string;
          }
        ).trialEndsAt,
      );
    const before = await trialEnd();
    const card = orgCard(page, 'Альта Групп');
    await card.getByRole('button', { name: EXTEND }).click();
    await confirmWithReason(
      commandDialog(page, 'Продлить пробный период «Альта Групп»?'),
      'Продлить',
      REASON,
    );
    await expect(toast(page)).toContainText(DONE);
    // Срок сервера — от позднейшего из текущего конца и «сейчас» сервера (контракт extendPlatformTrial): не раньше,
    // чем через 14 дней от прежнего конца; карточка показывает последний день нового срока.
    const after = await trialEnd();
    expect(after - before).toBeGreaterThanOrEqual(14 * 86_400_000);
    const date = new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(after - 1));
    await expect(cardValue(card, 'Пробный период')).toHaveText(
      new RegExp(`до ${date.replaceAll('.', '\\.')}$`),
    );
    await expect(journal(page).first().locator('.ox-audit-text')).toHaveText(
      'Альта Групп: пробный период продлён на 14 дней',
    );
  });

  test('стенд: 412 — продление и «Ограничить…» после правки другого оператора; повтор с ETag перечитанного ресурса', async ({
    app,
    page,
  }) => {
    // ETag W1.48 («"N"» / «"rev-N"») экран берёт из ответа дословно: If-Match первой попытки — показанный ETag,
    // повтора — ETag перечитанного после 412 ресурса, ключ идемпотентности — новый.
    const id = await openCard(app, page, 'Альта Групп');
    const card = orgCard(page, 'Альта Групп');
    const subPath = `/api/v1/platform/tenants/${id}/subscription`;
    const tenantPath = `/api/v1/platform/tenants/${id}`;
    const posts: { path: string; key: string; ifMatch: string; status?: number }[] = [];
    const rereads: Record<string, string[]> = { [subPath]: [], [tenantPath]: [] };
    page.on('request', (r) => {
      if (r.method() !== 'POST') return;
      const h = r.headers();
      posts.push({
        path: new URL(r.url()).pathname,
        key: h['idempotency-key'] ?? '',
        ifMatch: h['if-match'] ?? '',
      });
    });
    page.on('response', (r) => {
      const path = new URL(r.url()).pathname;
      if (r.request().method() === 'POST') {
        const p = posts.find((x) => x.path === path && x.status === undefined);
        if (p) p.status = r.status();
      } else if (r.request().method() === 'GET' && path in rereads && posts.length) {
        rereads[path]?.push(r.headers()['etag'] ?? '');
      }
    });

    // Продление: другой оператор продлил мимо экрана — ревизия подписки выросла.
    const shownSub = (await call(page, 'GET', subPath)).headers['etag'];
    expect(shownSub, 'ETag подписки W1.48').toMatch(/^"(rev-)?\d+"$/);
    const other = await call(page, 'POST', `${tenantPath}/trial-extensions`, {
      body: { reason: 'Продлил другой оператор', days: 14 },
      ifMatch: shownSub,
    });
    expect(other.status).toBe(200);
    posts.length = 0;
    await card.getByRole('button', { name: EXTEND }).click();
    const extend = commandDialog(page, 'Продлить пробный период «Альта Групп»?');
    await confirmWithReason(extend, 'Продлить', REASON);
    await expect(toast(page)).toContainText('Данные изменились. Обновите и повторите правку.', {
      timeout: 10_000,
    });
    await expect(extend).toBeVisible();
    await extend.getByRole('button', { name: 'Продлить', exact: true }).click();
    await expect(extend).toBeHidden({ timeout: 10_000 });
    const ext = posts.filter((p) => p.path.endsWith('/trial-extensions'));
    expect(ext.map((p) => p.status)).toEqual([412, 200]);
    expect(ext[0]?.ifMatch).toBe(shownSub);
    expect(ext[1]?.ifMatch).toBe(rereads[subPath]?.[0]);
    expect(ext[1]?.ifMatch).not.toBe(shownSub);
    expect(ext[1]?.key).not.toBe(ext[0]?.key);

    // «Ограничить…»: другой оператор приостановил и возобновил мимо экрана — ревизия организации выросла.
    const shownTenant = (await call(page, 'GET', tenantPath)).headers['etag'];
    expect(shownTenant, 'ETag организации W1.48').toMatch(/^"(rev-)?\d+"$/);
    for (const op of ['suspend', 'resume']) {
      const r = await call(page, 'POST', `${tenantPath}/${op}`, {
        body: { reason: 'Правка другого оператора' },
        ifMatch: (await call(page, 'GET', tenantPath)).headers['etag'],
      });
      expect(r.status, op).toBe(200);
    }
    posts.length = 0;
    await card.getByRole('button', { name: RESTRICT }).click();
    const restrict = commandDialog(page, 'Ограничить «Альта Групп»?');
    await confirmWithReason(restrict, 'Ограничить', REASON);
    await expect(toast(page)).toContainText('Данные изменились. Обновите и повторите правку.', {
      timeout: 10_000,
    });
    await restrict.getByRole('button', { name: 'Ограничить', exact: true }).click();
    await expect(restrict).toBeHidden({ timeout: 10_000 });
    const sus = posts.filter((p) => p.path.endsWith('/suspend'));
    expect(sus.map((p) => p.status)).toEqual([412, 200]);
    expect(sus[0]?.ifMatch).toBe(shownTenant);
    expect(sus[1]?.ifMatch).not.toBe(shownTenant);
    expect(sus[1]?.key).not.toBe(sus[0]?.key);
    await expect(card.locator('.ox-chip-label').first()).toHaveText('Приостановлен');
    // Вернуть «Альту» в исходное состояние для остальных строк @stand.
    await card.getByRole('button', { name: LIFT }).click();
    await confirmWithReason(commandDialog(page, 'Снять ограничение «Альта Групп»?'), LIFT, REASON);
    await expect(card.locator('.ox-chip-label').first()).toHaveText('Пробный период');
  });

  test('стенд: оплаченная «SPA «Лотос»» — кнопки продления нет; «Карго Сити» — «Снять ограничение»', async ({
    app,
    page,
  }) => {
    await openCard(app, page, 'SPA «Лотос»');
    await expect(orgCard(page, 'SPA «Лотос»').getByRole('button', { name: EXTEND })).toHaveCount(0);
    await orgRow(page, 'Карго Сити').click();
    await expect(orgCard(page, 'Карго Сити').getByRole('button', { name: LIFT })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
