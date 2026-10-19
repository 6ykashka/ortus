// W2.23 · e2e страницы `logistics-pool` «Ресурсный пул» (S2-14, AUTH-06/07; эталон design-stage-2 · Ортус CRM.dc.html
// pg.pool :515–557, poolVM :3300–3319; чек-лист 03-logistics.md §14 п. 14, 16, 17). Обязательные пункты
// verification-protocol §1.3. Диалог «Запросить водителя» — modal-driver-request.spec.ts. Демо-ответ «Одобрить» /
// «Отклонить» эталона (PD-54) заменён блоком входящих запросов фирмы-источника (Q-W2.51-2, no-reference): решает
// владелец «Альты» (approve на все фирмы) — персонаж `owner`.
import type { Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import {
  apiDecide,
  apiRequest,
  cardValue,
  driverCard,
  incoming,
  incomingCard,
  OFFLINE,
  openPool,
  phone,
  pool,
  POOL_H1,
  POOL_INTRO,
} from './logistics-pool.helpers.ts';
import { fromMenu } from './logistics.helpers.ts';
import { poolStand } from './logistics-pool.stand.ts';
import { realClock } from './logistics.stand.ts';
import { h1, hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import { call, devScenario } from './shell.helpers.ts';

const APPROVED_104 =
  'Водитель #104 назначен на рейс Р-211 до 18:00 01.10. Доступ ограничен этим рейсом; история и начисления остаются в фирме Юг Транс.';

test.describe('logistics-pool — «Ресурсный пул» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');
  test.setTimeout(90_000);

  test('меню «Логистика» → «Ресурсный пул» и прямой URL: крошка, заголовок, пояснение, «Что скрыто в пуле»', async ({
    app,
    page,
  }) => {
    await openPool(app, page, { route: 'home' });
    await fromMenu(page, POOL_H1, 'Пул');
    await expect(page).toHaveURL(/\/pool$/);
    await expect(h1(page, POOL_H1)).toBeVisible();
    await expect(pool(page).locator('.ox-pl-crumb')).toHaveText(
      'Москва / межфирменный ресурсный пул',
    );
    await expect(pool(page).getByText(POOL_INTRO)).toBeVisible();
    const aside = pool(page).locator('aside');
    await expect(aside.getByRole('heading', { level: 3, name: 'Что скрыто в пуле' })).toBeVisible();
    await expect(aside.locator('li')).toContainText([
      'ФИО и личный телефон — до одобрения',
      'Ставки и начисления другой фирмы',
      'История рейсов и текущие задания',
      'Документы сверх согласованного объёма',
    ]);
    await expect(aside).toContainText(
      'После одобрения создаётся временное назначение на конкретный рейс со сроком. История и начисления остаются в домашней фирме.',
    );
    await page.reload();
    await expect(h1(page, POOL_H1)).toBeVisible({ timeout: 15_000 });
  });

  test('каталог на окно Р-211 (п. 14): Водитель #104 и #117, «Свободен», «Запросить на рейс Р-211»', async ({
    app,
    page,
  }) => {
    await openPool(app, page);
    const a = driverCard(page, 'Водитель #104');
    await expect(a).toContainText('Кат. C · рефрижератор · Юг Транс');
    await expect(a.locator('.ox-pl-chip')).toContainText('Свободен');
    await expect(cardValue(a, 'Свободен')).toHaveText('13:00–19:00');
    await expect(cardValue(a, 'Условия')).toHaveText('По соглашению фирм группы');
    await expect(a.getByRole('button', { name: 'Запросить на рейс Р-211' })).toBeVisible();
    const b = driverCard(page, 'Водитель #117');
    await expect(b).toContainText('Кат. B · Восток Карго');
    await expect(cardValue(b, 'Свободен')).toHaveText('15:00–20:00');
    await expect(b.getByRole('button', { name: 'Запросить на рейс Р-211' })).toBeVisible();
    await expect(page.locator('article.ox-pl-driver')).toHaveCount(2);
    await expect(incoming(page)).toHaveCount(0);
  });

  test('запрос отправлен (п. 15): чип «Запрос отправлен», «Ожидает решения…», у #117 запрос есть', async ({
    app,
    page,
  }) => {
    const alta = await openPool(app, page);
    await apiRequest(page, alta);
    await page.reload();
    const a = driverCard(page, 'Водитель #104');
    await expect(a.locator('.ox-pl-chip')).toContainText('Запрос отправлен', { timeout: 15_000 });
    await expect(a.getByRole('status')).toContainText(
      'Ожидает решения менеджера фирмы Юг Транс. Доступа к водителю пока нет.',
    );
    await expect(a.getByRole('button', { name: /Запросить на рейс/ })).toHaveCount(0);
    await expect(a.getByRole('button', { name: 'Одобрить' })).toHaveCount(0);
    await expect(
      driverCard(page, 'Водитель #117').getByRole('button', { name: 'Запросить на рейс Р-211' }),
    ).toBeVisible();
  });

  test('владелец одобряет во «Входящих запросах» (п. 16): логист видит «Временно назначен»', async ({
    app,
    page,
  }) => {
    const alta = await openPool(app, page);
    await apiRequest(page, alta);
    await app(`/t/${alta}/pool`, { persona: 'owner' });
    const row = incomingCard(page, 'Водитель #104');
    await expect(incoming(page).getByRole('heading', { level: 2 })).toHaveText('Входящие запросы');
    await expect(row).toContainText('Север Логистик · рейс Р-211');
    await expect(row).toContainText('01.10.2026 · 14:00–18:00');
    await expect(row).toContainText('Запрос на рейс Р-211');
    await row.getByLabel('Комментарий к решению').fill('Отпускаем до конца смены');
    await row.getByRole('button', { name: 'Одобрить' }).click();
    await expect(toast(page)).toHaveText('Фирма Юг Транс одобрила запрос');
    await expect(incoming(page)).toHaveCount(0);
    await app(`/t/${alta}/pool`, { persona: 'manager' });
    const a = driverCard(page, 'Водитель #104');
    await expect(a.locator('.ox-pl-chip')).toContainText('Временно назначен');
    await expect(a.getByRole('status')).toContainText(APPROVED_104);
    await expect(cardValue(a, 'Срок')).toHaveText('14:00–18:00');
    await expect(
      driverCard(page, 'Водитель #117').getByRole('button', { name: /Запросить на рейс/ }),
    ).toHaveCount(0);
  });

  test('отклонение (п. 17): «Запрос отклонён. Можно запросить другого водителя.», запрос снова доступен', async ({
    app,
    page,
  }) => {
    const alta = await openPool(app, page);
    await apiRequest(page, alta);
    await app(`/t/${alta}/pool`, { persona: 'owner' });
    await incomingCard(page, 'Водитель #104').getByRole('button', { name: 'Отклонить' }).click();
    await expect(toast(page)).toHaveText('Фирма Юг Транс отклонила запрос');
    await app(`/t/${alta}/pool`, { persona: 'manager' });
    const a = driverCard(page, 'Водитель #104');
    await expect(a.locator('.ox-pl-chip')).toContainText('Отклонён');
    await expect(a).toContainText('Запрос отклонён. Можно запросить другого водителя.');
    await expect(a.getByRole('button', { name: 'Запросить на рейс Р-211' })).toBeVisible();
    // Повторный запрос того же водителя на тот же рейс — новый запрос (новый Idempotency-Key, возврат 1).
    await a.getByRole('button', { name: 'Запросить на рейс Р-211' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(toast(page)).toHaveText('Запрос отправлен фирме Юг Транс');
    await expect(a.locator('.ox-pl-chip')).toContainText('Запрос отправлен');
    const r = await call(
      page,
      'GET',
      `/api/v1/tenants/${alta}/fleet/driver-transfer-requests?direction=outgoing&limit=200`,
    );
    const mine = (r.body as { items: { driverDisplayName?: string; status: string }[] }).items
      .filter((x) => x.driverDisplayName === 'Водитель #104')
      .map((x) => x.status)
      .sort();
    expect(mine).toEqual(['rejected', 'requested']);
  });

  test('одобрение после того, как рейс получил водителя: 409 — тост текстом сервера, список перечитан', async ({
    app,
    page,
  }) => {
    const alta = await openPool(app, page);
    const first = await apiRequest(page, alta, 'Водитель #104');
    await app(`/t/${alta}/pool`, { persona: 'owner' });
    const second = await apiRequest(page, alta, 'Водитель #117');
    // Запрос #117 создан после первой загрузки входящих — экран перечитывается (иначе гонка с первым GET).
    await page.reload();
    await expect(incomingCard(page, 'Водитель #117')).toBeVisible({ timeout: 15_000 });
    // Запрос #104 одобрен «за спиной» экрана: у Р-211 появился водитель.
    await apiDecide(page, alta, first.id, 'approve');
    await incomingCard(page, 'Водитель #117').getByRole('button', { name: 'Одобрить' }).click();
    await expect(toast(page)).toHaveText('У рейса уже есть водитель.');
    await expect(incomingCard(page, 'Водитель #104')).toHaveCount(0);
    expect(second.id).toBeTruthy();
  });

  test('пусто: нет свободных водителей на окно рейса; нет рейса без водителя', async ({
    app,
    page,
  }) => {
    const alta = await openPool(app, page);
    await devScenario(page, { scenario: 'listAvailableDrivers=empty' });
    await page.reload();
    await expect(pool(page).getByText('В пуле нет свободных водителей на это время')).toBeVisible({
      timeout: 15_000,
    });
    await devScenario(page, { scenario: 'listTripPlans=empty' });
    await page.reload();
    await expect(pool(page).getByText('Нет рейсов без водителя')).toBeVisible({ timeout: 15_000 });
    await devScenario(page, { scenario: null });
    expect(alta).toBeTruthy();
  });

  test('загрузка — скелетон; ошибка — «Повторить»', async ({ app, page }) => {
    const alta = await openPool(app, page, { route: 'home' });
    await devScenario(page, { scenario: 'listAvailableDrivers=rate_limited' });
    await app(`/t/${alta}/pool`, { persona: 'manager' });
    await expect(page.getByText(/^Не удалось загрузить пул: /)).toHaveText(
      'Не удалось загрузить пул: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: 'listAvailableDrivers=delay=1500' });
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByRole('main').getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await devScenario(page, { scenario: null });
    await expect(driverCard(page, 'Водитель #104')).toBeVisible();
  });

  test('нет связи при решении: тост «нет связи», запрос остаётся во входящих', async ({
    app,
    page,
  }) => {
    const alta = await openPool(app, page);
    await apiRequest(page, alta);
    await app(`/t/${alta}/pool`, { persona: 'owner' });
    await devScenario(page, { scenario: 'decideDriverTransfer=offline' });
    await incomingCard(page, 'Водитель #104').getByRole('button', { name: 'Одобрить' }).click();
    await expect(toast(page)).toHaveText(OFFLINE);
    await devScenario(page, { scenario: null });
    await expect(
      incomingCard(page, 'Водитель #104').getByRole('button', { name: 'Одобрить' }),
    ).toBeEnabled();
  });

  test('организация только для чтения: запроса и решений нет', async ({ app, page }) => {
    const alta = await openPool(app, page);
    await apiRequest(page, alta, 'Водитель #117');
    await devScenario(page, { preset: 'trial-ended' });
    await app(`/t/${alta}/pool`, { persona: 'owner' });
    await expect(driverCard(page, 'Водитель #104')).toBeVisible();
    await expect(page.getByRole('button', { name: /Запросить на рейс/ })).toHaveCount(0);
    for (const name of ['Одобрить', 'Отклонить']) {
      await expect(
        incomingCard(page, 'Водитель #117').getByRole('button', { name }),
      ).toBeDisabled();
    }
  });

  test('водитель: гейт «Нет роли с доступом»', async ({ app, page }) => {
    await openPool(app, page, { persona: 'driver' });
    await expect(page.getByText(/Нет роли с доступом/)).toBeVisible();
  });

  test('1440 — боковая панель, 390 — нижняя навигация «Пул»; без горизонтальной прокрутки, цели ≥ 44 px', async ({
    app,
    page,
  }) => {
    await openPool(app, page);
    await expect(driverCard(page, 'Водитель #104')).toBeVisible();
    if (phone(page)) {
      const bottom = page.getByRole('navigation', { name: 'Навигация', exact: true });
      await expect(bottom).toBeVisible();
      await expect(bottom.getByRole('button', { name: 'Пул', exact: true })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeHidden();
      for (const code of ['Водитель #104', 'Водитель #117']) {
        expect(
          await hitHeight(driverCard(page, code).getByRole('button', { name: /Запросить/ })),
        ).toBeGreaterThanOrEqual(44);
      }
    } else {
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
    }
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('клавиатура: Tab до «Запросить на рейс», фокус виден, Enter открывает диалог; axe без serious', async ({
    app,
    page,
    axe,
  }) => {
    const alta = await openPool(app, page);
    await apiRequest(page, alta, 'Водитель #117');
    await app(`/t/${alta}/pool`, { persona: 'owner' });
    await expect(incomingCard(page, 'Водитель #117')).toBeVisible();
    const bad = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(bad.map((v) => v.id)).toEqual([]);
    const btn = driverCard(page, 'Водитель #104').getByRole('button', {
      name: 'Запросить на рейс Р-211',
    });
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await btn.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(await btn.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('?trip= — рейс запроса из адреса; без него — первый рейс без водителя', async ({
    app,
    page,
  }) => {
    const alta = await openPool(app, page);
    const r = await call(page, 'GET', `/api/v1/tenants/${alta}/fleet/trip-plans?limit=200`);
    const r208 = (r.body as { items: { id: string; number: string }[] }).items.find(
      (t) => t.number === 'Р-208',
    );
    await app(`/t/${alta}/pool?trip=${r208?.id ?? ''}`, { persona: 'manager' });
    // У Р-208 уже есть водитель — запросить на него нельзя; каталог — на его окно 09:00–13:00: #104 свободен с 13:00,
    // #117 — с 15:00, свободных на это время нет.
    await expect(h1(page, POOL_H1)).toBeVisible();
    await expect(pool(page).getByText('В пуле нет свободных водителей на это время')).toBeVisible();
    await expect(page.getByRole('button', { name: /Запросить на рейс/ })).toHaveCount(0);
    // Без ?trip= — первый рейс без водителя: Р-211, каталог на 14:00–18:00.
    await app(`/t/${alta}/pool`, { persona: 'manager' });
    await expect(
      driverCard(page, 'Водитель #104').getByRole('button', { name: 'Запросить на рейс Р-211' }),
    ).toBeVisible();
    await expect(page.getByLabel('Рейс для запроса')).toHaveCount(0);
  });

  test('«Рейс для запроса»: два рейса без водителя — выбор, ?trip=, каталог на окно выбранного', async ({
    app,
    page,
  }) => {
    const alta = await openPool(app, page);
    const evening = await eveningTrip(page, alta);
    await page.reload();
    const pick = pool(page).getByLabel('Рейс для запроса');
    await expect(pick.locator('option')).toHaveText([
      'Р-211 · Охлаждённая продукция · 14:00–18:00',
      `${evening.number} · Вечерний рейс · 19:00–21:00`,
    ]);
    await expect(pick.locator('option:checked')).toHaveText(/^Р-211 /);
    await pick.selectOption(evening.id);
    await expect(page).toHaveURL(new RegExp(`[?&]trip=${evening.id}`));
    const b = driverCard(page, 'Водитель #117');
    await expect(
      b.getByRole('button', { name: `Запросить на рейс ${evening.number}` }),
    ).toBeVisible();
    await expect(driverCard(page, 'Водитель #104')).toHaveCount(0);
    await b.getByRole('button', { name: `Запросить на рейс ${evening.number}` }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toContainText(`${evening.number} · Вечерний рейс · 19:00–21:00`);
    await expect(dlg).toContainText('Временно, до 20:00 01.10');
  });

  // Возврат 2: открытый запрос у публикации один на любой рейс (driver_transfers_open_uq, MSW pool.ts) — он блокирует
  // «Запросить» и на другом рейсе; отклонённый запрос другого рейса состояние выбранного не задаёт (Q-W2.23-1).
  test('открытый запрос на другой рейс: на Р-211 «Запрос отправлен» без запроса; после отклонения — «Свободен»', async ({
    app,
    page,
  }) => {
    const alta = await openPool(app, page);
    const evening = await eveningTrip(page, alta);
    const sent = await apiRequest(page, alta, 'Водитель #117', evening.number);
    await page.reload();
    await expect(pool(page).getByLabel('Рейс для запроса').locator('option:checked')).toHaveText(
      /^Р-211 /,
      { timeout: 15_000 },
    );
    const b = driverCard(page, 'Водитель #117');
    await expect(b.locator('.ox-pl-chip')).toContainText('Запрос отправлен');
    await expect(b.getByRole('status')).toContainText(
      'Ожидает решения менеджера фирмы Восток Карго. Доступа к водителю пока нет.',
    );
    await expect(b.getByRole('button', { name: /Запросить на рейс/ })).toHaveCount(0);
    await expect(
      driverCard(page, 'Водитель #104').getByRole('button', { name: 'Запросить на рейс Р-211' }),
    ).toBeVisible();
    // Фирма-источник отклонила запрос вечернего рейса: на Р-211 водитель снова «Свободен», на вечернем — «Отклонён».
    await app(`/t/${alta}/pool`, { persona: 'owner' });
    await apiDecide(page, alta, sent.id, 'reject');
    await app(`/t/${alta}/pool`, { persona: 'manager' });
    await expect(b.locator('.ox-pl-chip')).toContainText('Свободен', { timeout: 15_000 });
    await expect(b.getByRole('button', { name: 'Запросить на рейс Р-211' })).toBeVisible();
    await pool(page).getByLabel('Рейс для запроса').selectOption(evening.id);
    await expect(b.locator('.ox-pl-chip')).toContainText('Отклонён');
    await expect(
      b.getByRole('button', { name: `Запросить на рейс ${evening.number}` }),
    ).toBeVisible();
  });
});

/** Вечерний рейс «Север Логистик» без водителя, 19:00–21:00: свободен только #117 (15:00–20:00). */
async function eveningTrip(page: Page, alta: string): Promise<{ id: string; number: string }> {
  const list = await call(page, 'GET', `/api/v1/tenants/${alta}/fleet/trip-plans?limit=200`);
  const r211 = (list.body as { items: { number: string; orgUnitId: string }[] }).items.find(
    (t) => t.number === 'Р-211',
  );
  const at = (h: string) => `2026-10-01T${h}:00:00Z`;
  const created = await call(page, 'POST', `/api/v1/tenants/${alta}/fleet/trip-plans`, {
    body: {
      orgUnitId: r211?.orgUnitId,
      title: 'Вечерний рейс',
      plannedWindow: { startsAt: at('16'), endsAt: at('18'), timeZone: 'Europe/Moscow' },
      distanceKm: '35',
      cargo: {
        description: 'Сухой груз · 5 паллет-мест',
        weightKg: '400',
        volumeM3: '5',
        lengthM: '2',
      },
      stops: [
        {
          sequence: 1,
          op: 'load',
          address: 'Склад № 1, Лобня',
          weightKg: '400',
          volumeM3: '5',
          plannedAt: at('16'),
        },
        {
          sequence: 2,
          op: 'unload',
          address: 'Химки, ул. Заводская, 8',
          weightKg: '400',
          volumeM3: '5',
          plannedAt: at('17'),
        },
      ],
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body as { id: string; number: string };
}

// W2.07 (пул на backend) в main — строки стенда без fixme. Сида пула на стенде нет (Q-W2.07-5): водителя публикует
// владелец через API (publishDriverToPool), рейс фирмы-получателя «Юг Транс» — его же createTripPlan; уборка — отзыв
// назначения и снятие публикации (logistics-pool.stand.ts).
test.describe('logistics-pool — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('владелец на стенде: публикация → «Запросить на рейс» → входящие → «Одобрить» → «Временно назначен»', async ({
    app,
    page,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(180_000);
    await realClock(page);
    const s = await poolStand(session, undo, testInfo.project.name);
    await app(`/t/${s.tenant}/pool?trip=${s.trip.id}`, { persona: 'owner' });
    await expect(h1(page, POOL_H1)).toBeVisible({ timeout: 15_000 });
    const card = driverCard(page, s.code);
    await expect(card).toContainText('Кат. B · Север Логистик');
    await expect(card.locator('.ox-pl-chip')).toContainText('Свободен');
    await card.getByRole('button', { name: `Запросить на рейс ${s.trip.number}` }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toContainText(`${s.code} · Север Логистик`);
    await expect(dlg).toContainText('Менеджер фирмы Север Логистик');
    await dlg.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(toast(page)).toHaveText('Запрос отправлен фирме Север Логистик', {
      timeout: 15_000,
    });
    await expect(card.locator('.ox-pl-chip')).toContainText('Запрос отправлен');
    const row = incomingCard(page, s.code);
    await expect(row).toContainText(`Юг Транс · рейс ${s.trip.number}`);
    await row.getByRole('button', { name: 'Одобрить' }).click();
    await expect(toast(page)).toHaveText('Фирма Север Логистик одобрила запрос', {
      timeout: 15_000,
    });
    await expect(card.locator('.ox-pl-chip')).toContainText('Временно назначен');
    await expect(card.getByRole('status')).toContainText(
      `${s.code} назначен на рейс ${s.trip.number} до`,
    );
  });

  test('логист Котова на стенде: водитель «Юг Транс» → «Запросить на рейс» своего рейса → одобрение → «Временно назначен»', async ({
    app,
    page,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(180_000);
    await realClock(page);
    const s = await poolStand(session, undo, testInfo.project.name, { foreign: true });
    await app(`/t/${s.tenant}/pool?trip=${s.trip.id}`, { persona: 'manager' });
    await expect(h1(page, POOL_H1)).toBeVisible({ timeout: 15_000 });
    const card = driverCard(page, s.code);
    await expect(card).toContainText('Кат. B · Юг Транс');
    await expect(card.locator('.ox-pl-chip')).toContainText('Свободен');
    // Право fleet.driver_transfers.request на «Север Логистик» (may() клиента) и requestDriverTransfer стенда.
    await card.getByRole('button', { name: `Запросить на рейс ${s.trip.number}` }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toContainText(`${s.code} · Юг Транс`);
    await expect(dlg).toContainText('Менеджер фирмы Юг Транс');
    await dlg.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(toast(page)).toHaveText('Запрос отправлен фирме Юг Транс', { timeout: 15_000 });
    await expect(card.locator('.ox-pl-chip')).toContainText('Запрос отправлен');
    await expect(card.getByRole('status')).toContainText(
      'Ожидает решения менеджера фирмы Юг Транс. Доступа к водителю пока нет.',
    );
    // Решает фирма-источник: владелец через API (экрана менеджера «Юг Транс» в сиде нет).
    const list = await call(
      s.owner,
      'GET',
      `/api/v1/tenants/${s.tenant}/fleet/driver-transfer-requests?status=requested&limit=200`,
    );
    const req = (list.body as { items: { id: string; publicationId?: string }[] }).items.find(
      (x) => x.publicationId === s.publicationId,
    );
    expect(req, 'запрос Котовой на стенде').toBeTruthy();
    await apiDecide(s.owner, s.tenant, req?.id ?? '', 'approve');
    await page.reload();
    await expect(card.locator('.ox-pl-chip')).toContainText('Временно назначен', {
      timeout: 15_000,
    });
    await expect(card.getByRole('status')).toContainText(
      `${s.code} назначен на рейс ${s.trip.number} до`,
    );
    await expect(card.getByRole('status')).toContainText('остаются в фирме Юг Транс');
  });

  test('логист на стенде: «Ресурсный пул» открывается, своих водителей в каталоге нет', async ({
    app,
    page,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(180_000);
    await realClock(page);
    const s = await poolStand(session, undo, testInfo.project.name);
    await app(`/t/${s.tenant}/pool`, { persona: 'manager' });
    await expect(h1(page, POOL_H1)).toBeVisible({ timeout: 15_000 });
    await expect(pool(page).getByText(POOL_INTRO)).toBeVisible();
    // Опубликован водитель «Север Логистик» — своя фирма Котовой: в её каталоге его нет (AUTH-06, W2.07).
    await expect(driverCard(page, s.code)).toHaveCount(0);
  });
});
