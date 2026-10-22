// W4.61 · e2e страницы `platform-requests` — «Заявки на изменение тарифа» оператора (эталон design-2026-10-19,
// «Ортус CRM.dc.html» pg.requests :945–985, requestsVM :3586–3617; чек-лист docs/plan/analysis/04-platform.md §8
// п. 21–25, обязательные пункты verification-protocol.md §1.3). Цена — расчёт заявки по её версии сетки (Q-W4.07-2).
import { collectLabels } from '@ortus/e2e-kit';

import { expect, test } from './fixtures/index.ts';
import { confirmDialog, openPlatform, section, textOf, toastText } from './billing.helpers.ts';
import { hitHeight, noHorizontalScroll } from './modules.helpers.ts';
import { devScenario } from './shell.helpers.ts';

const H1 = { level: 1, name: 'Заявки на изменение тарифа' } as const;
const INTRO =
  'Владелец выбирает тариф и срок, оператор подтверждает после оплаты. Повышение начинает действовать сразу после подтверждения, понижение — со следующего периода и только если мест хватает.';

const card = (root: import('@playwright/test').Locator, number: string) =>
  root.locator('article').filter({ hasText: number });

test.describe('platform-requests — «Заявки на тариф» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'данные сида MSW и сценарии — режим mock');
  // Под нагрузкой общей машины вход и холодная загрузка страницы занимают до 30 с.
  test.describe.configure({ timeout: 60_000 });

  test('меню «Заявки на тариф» с бейджем и прямой URL: заголовок, описание, data-screen-label', async ({
    app,
    page,
  }) => {
    await app('/platform/tenants', { persona: 'operator' });
    await page.setViewportSize({ width: 1440, height: 900 });
    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    const item = nav.getByRole('button', { name: /^Заявки на тариф/ });
    await expect(item.locator('.ox-nav-badge')).toHaveText('1');
    // Возврат 2 (Q-W4.50-10): подпись для структурной сверки shell (collectLabels) — с пробелом перед бейджем.
    const labels = await collectLabels(nav);
    expect(labels).toContain('button:Заявки на тариф 1');
    await item.click();
    await expect(page).toHaveURL(/\/platform\/requests$/);
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
    await expect(item).toHaveAttribute('aria-current', 'page');
    const root = section(page, 'h-req');
    await expect(root).toHaveAttribute('data-screen-label', 'Оператор · заявки');
    await expect(root).toContainText('Платформа Ортус');
    await expect(root.getByText(INTRO)).toBeVisible();
    await page.goto('/platform/requests');
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
  });

  test('фильтр «На рассмотрении · 1» и карточка SR-12 (04 §8 п. 21)', async ({ app, page }) => {
    const root = await openPlatform(app, page, 'requests');
    const filter = root.getByRole('group', { name: 'Фильтр заявок' });
    await expect(filter.getByRole('button')).toHaveText(['На рассмотрении · 1', 'Все заявки · 2']);
    await expect(filter.getByRole('button', { name: 'На рассмотрении · 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(root.locator('article')).toHaveCount(1);
    const sr12 = card(root, 'SR-12');
    await expect(sr12.getByRole('heading', { level: 2, name: 'SPA «Лотос»' })).toBeVisible();
    await expect(sr12.locator('.ox-chip-label')).toHaveText('На рассмотрении');
    await expect(sr12.locator('.ox-rq-meta')).toHaveText('29.09 16:40 · Ирина Белова');
    const dl = sr12.locator('dl');
    expect(await textOf(dl)).toBe(
      'Сейчас «Команда» · до 25 мест Запрошено «Бизнес» · до 50 мест Занято мест 23 из 50 после перехода Срок оплаты 12 месяцев',
    );
    expect(await textOf(sr12.locator('.ox-rq-price'))).toBe(
      'payments11 920 ₽ в месяц · 143 040 ₽ за период · скидка 20%',
    );
    await expect(
      sr12.getByText('Комментарий владельца: «Открываем второй салон, нужно ещё 10–12 мест»'),
    ).toBeVisible();
    await expect(sr12.getByLabel('Комментарий для владельца')).toHaveAttribute(
      'placeholder',
      'Например: оплата по счёту получена · обязателен при отказе',
    );
    await expect(sr12.getByRole('button', { name: 'Отклонить' })).toBeVisible();
    await expect(sr12.getByRole('button', { name: 'Подтвердить и подключить' })).toBeVisible();
  });

  test('«Все заявки · 2»: SR-9 подтверждена, строка решения, без поля и кнопок (04 §8 п. 22)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'requests');
    await root.getByRole('button', { name: 'Все заявки · 2' }).click();
    await expect(page).toHaveURL(/\/platform\/requests\?status=all$/);
    await expect(root.locator('article')).toHaveCount(2);
    const sr9 = card(root, 'SR-9');
    await expect(sr9.getByRole('heading', { level: 2, name: 'Карго Сити' })).toBeVisible();
    await expect(sr9.locator('.ox-chip-label')).toHaveText('Подтверждена');
    await expect(sr9.locator('.ox-rq-meta')).toHaveText('12.05 11:02 · Денис Шишкин');
    await expect(
      sr9.getByText('Подтверждена · Е. Лаптева · 12.05 15:20 — Оплата по счёту получена'),
    ).toBeVisible();
    await expect(sr9.locator('textarea')).toHaveCount(0);
    await expect(sr9.getByRole('button')).toHaveCount(0);
    expect(await textOf(sr9.locator('dl'))).toContain('Срок оплаты 4 месяцев');
  });

  test('«Отклонить» без комментария — тост «Напишите причину отказа…», диалога нет (04 §8 п. 23)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'requests');
    await card(root, 'SR-12').getByRole('button', { name: 'Отклонить' }).click();
    await expect(toastText(page)).toHaveText('Напишите причину отказа в поле комментария');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('отказ с причиной: диалог, «На рассмотрении · 0», пусто, «Отклонена», бейдж исчез (04 §8 п. 24)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'requests');
    const sr12 = card(root, 'SR-12');
    await sr12.getByLabel('Комментарий для владельца').fill('Нет оплаты');
    await sr12.getByRole('button', { name: 'Отклонить' }).click();
    const d = confirmDialog(page, 'Отклонить заявку SR-12?');
    await expect(d).toBeVisible();
    await expect(d).toContainText('Владелец увидит причину: «Нет оплаты».');
    await expect(d.locator('li')).toHaveText([
      'blockТариф и лимит мест не меняются',
      'inventory_2Участники и данные организации не затрагиваются',
    ]);
    const ok = d.getByRole('button', { name: 'Отклонить' });
    await expect(ok).toHaveCSS('background-color', 'rgb(161, 58, 51)');
    await ok.click();
    await expect(toastText(page)).toHaveText('Готово · запись добавлена в журнал');
    await expect(root.getByRole('button', { name: 'На рассмотрении · 0' })).toBeVisible();
    await expect(
      root.getByText(
        'Новых заявок нет. Заявки появляются, когда владелец запрашивает другой тариф.',
      ),
    ).toBeVisible();
    await root.getByRole('button', { name: 'Все заявки · 2' }).click();
    await expect(card(root, 'SR-12').locator('.ox-chip-label')).toHaveText('Отклонена');
    await expect(
      card(root, 'SR-12').getByText(
        /^Отклонена · Е\. Лаптева · \d\d\.\d\d \d\d:\d\d — Нет оплаты$/,
      ),
    ).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    await expect(nav.locator('.ox-nav-badge')).toHaveCount(0);
  });

  test('подтверждение: диалог с суммой, бейдж исчез, «Использование» без сигнала Лотоса (04 §8 п. 25)', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'requests');
    await card(root, 'SR-12').getByRole('button', { name: 'Подтвердить и подключить' }).click();
    const d = confirmDialog(page, 'Подтвердить заявку SR-12?');
    await expect(d).toContainText('SPA «Лотос» переходит на «Бизнес» · до 50 мест.');
    await expect(d.locator('li')).toHaveText([
      'group_addЛимит мест меняется сразу: владелец сможет приглашать сотрудников',
      'receipt_longПодписка на 12 мес, 143 040 ₽ за период. В пилоте оплату подтверждает оператор',
      'historyРешение попадёт в журнал и в уведомления владельца',
    ]);
    await d.getByRole('button', { name: 'Подтвердить' }).click();
    await expect(toastText(page)).toHaveText('Готово · запись добавлена в журнал');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(root.locator('article')).toHaveCount(0);
    const usage = await openPlatform(app, page, 'usage');
    await expect(usage.locator('.ox-us-signal').filter({ hasText: 'SPA «Лотос»' })).toHaveCount(0);
    await expect(usage.locator('.ox-us-tile').nth(1)).toContainText('59 из 95');
  });

  test('повторное решение: 409 — тост «Заявка уже рассмотрена или отменена», диалог открыт', async ({
    app,
    page,
  }) => {
    const root = await openPlatform(app, page, 'requests');
    await card(root, 'SR-12').getByRole('button', { name: 'Подтвердить и подключить' }).click();
    await devScenario(page, {
      scenario: 'decidePlatformSubscriptionRequest=invalid_transition',
      once: true,
    });
    const d = confirmDialog(page, 'Подтвердить заявку SR-12?');
    await d.getByRole('button', { name: 'Подтвердить' }).click();
    await expect(page.locator('.ox-toast[role="alert"]')).toBeVisible();
    await expect(d).toBeVisible();
  });

  test('нет связи: тост warn, диалог остаётся открытым', async ({ app, page }) => {
    const root = await openPlatform(app, page, 'requests');
    await card(root, 'SR-12').getByRole('button', { name: 'Подтвердить и подключить' }).click();
    await devScenario(page, { scenario: 'decidePlatformSubscriptionRequest=offline', once: true });
    const d = confirmDialog(page, 'Подтвердить заявку SR-12?');
    await d.getByRole('button', { name: 'Подтвердить' }).click();
    await expect(toastText(page)).toHaveText('Нет связи с сервером. Операция не выполнена.');
    await expect(d).toBeVisible();
  });

  test('Escape закрывает диалог, фокус возвращается на кнопку', async ({ app, page }) => {
    const root = await openPlatform(app, page, 'requests');
    const approve = card(root, 'SR-12').getByRole('button', { name: 'Подтвердить и подключить' });
    await approve.click();
    await expect(confirmDialog(page, 'Подтвердить заявку SR-12?')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(approve).toBeFocused();
  });

  test('загрузка: скелетон «Загрузка» до ответа listPlatformSubscriptionRequests (no-reference)', async ({
    app,
    page,
  }) => {
    await openPlatform(app, page, 'requests');
    await devScenario(page, { scenario: 'listPlatformSubscriptionRequests=delay=2500' });
    await page.reload();
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
    const root = section(page, 'h-req');
    const status = root.getByRole('status', { name: 'Загрузка' });
    await expect(status).toBeVisible();
    await expect(root.locator('article')).toHaveCount(1, { timeout: 15_000 });
    await expect(status).toHaveCount(0);
    await devScenario(page, { scenario: null });
  });

  test('нет связи при чтении: alert «Нет связи с сервером…» (no-reference)', async ({
    app,
    page,
  }) => {
    await openPlatform(app, page, 'requests');
    await devScenario(page, { scenario: 'listPlatformSubscriptionRequests=offline' });
    await page.reload();
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
    await expect(section(page, 'h-req').getByRole('alert')).toContainText(
      'Не удалось загрузить заявки: Нет связи с сервером. Проверьте подключение.',
      { timeout: 15_000 },
    );
    await devScenario(page, { scenario: null });
  });

  test('ошибка списка: alert и «Повторить» (no-reference)', async ({ app, page }) => {
    await openPlatform(app, page, 'requests');
    // Бейдж меню читает ту же операцию: сценарий постоянный, снимается перед «Повторить».
    await devScenario(page, { scenario: 'listPlatformSubscriptionRequests=rate_limited' });
    await page.reload();
    // Возврат 1 (флак на 390): после reload оболочка под нагрузкой грузится дольше 5 с ожидания по умолчанию.
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
    const alert = section(page, 'h-req').getByRole('alert');
    await expect(alert).toContainText('Не удалось загрузить заявки: Слишком много запросов', {
      timeout: 15_000,
    });
    await devScenario(page, { scenario: null });
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(section(page, 'h-req').locator('article')).toHaveCount(1);
  });

  test('нет права роли (поддержка): текст раздела вместо очереди (no-reference)', async ({
    app,
    page,
  }) => {
    await openPlatform(app, page, 'requests');
    await devScenario(page, { scenario: 'listPlatformSubscriptionRequests=forbidden_action' });
    await page.reload();
    await expect(page.getByRole('heading', H1)).toBeVisible({ timeout: 15_000 });
    await expect(
      section(page, 'h-req').getByText(
        'Нет права на заявки на тариф: раздел доступен ролям «Владелец платформы», «Администратор» и «Биллинг».',
      ),
    ).toBeVisible({ timeout: 15_000 });
    await devScenario(page, { scenario: null });
  });

  test('390: без горизонтальной прокрутки, кнопки решения ≥ 44 px', async ({ app, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const root = await openPlatform(app, page, 'requests');
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(
      await hitHeight(root.getByRole('button', { name: 'На рассмотрении · 1' })),
    ).toBeGreaterThanOrEqual(44);
    expect(
      await hitHeight(root.getByRole('button', { name: 'Подтвердить и подключить' })),
    ).toBeGreaterThanOrEqual(44);
  });

  test('axe: нет нарушений serious/critical (очередь и диалог)', async ({ app, page, axe }) => {
    const root = await openPlatform(app, page, 'requests');
    let r = await axe(page);
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
    await card(root, 'SR-12').getByRole('button', { name: 'Подтвердить и подключить' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    r = await axe(page);
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
  });
});

test.describe('platform-requests — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test.fixme('оператор стенда: очередь заявок сида и решение', async ({ app, page }) => {
    // W4.60 (backend шага 4.6: listPlatformSubscriptionRequests, decidePlatformSubscriptionRequest) не в main.
    const root = await openPlatform(app, page, 'requests');
    await expect(root.getByRole('group', { name: 'Фильтр заявок' })).toBeVisible();
  });
});
