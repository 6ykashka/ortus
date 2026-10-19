// W2.21 · e2e страницы `logistics-defects` «Очередь блокирующих дефектов» (S2-17; no-reference B-6 №7,
// design-requests «defect-queue», 14-stage2-dor.md §4: пусто, есть дефекты, решение принято, решён другим — 409).
// Дефект готовит водитель через API (logistics-review.helpers.ts), решает менеджер на экране. Обязательные пункты
// verification-protocol §1.3 и брифа §1 п. 7: загрузка, ошибка, нет связи, только чтение, клавиатура, 390 / 1440.
import { expect, test } from './_stand/fixtures.ts';
import { driverShift, phone } from './logistics-review.helpers.ts';
import {
  akhmedov,
  AKHMEDOV,
  apiDeparture,
  apiReturn,
  apiStart,
  approve,
  closeTrip,
  GAZEL,
  label,
  logisticsOn,
  newTrip,
  NO_STORAGE,
  realClock,
  storageReachable,
} from './logistics.stand.ts';
import { h1, hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import { call, devScenario, tenantId } from './shell.helpers.ts';

const H1 = 'Очередь блокирующих дефектов';
const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';

const card = (page: import('@playwright/test').Page, title = 'Стёкла: Скол') =>
  page.locator('article').filter({ has: page.getByRole('heading', { level: 2, name: title }) });

test.describe('logistics-defects — очередь блокирующих дефектов @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');
  test.setTimeout(90_000);

  test('ссылка со «Приёмки смен» и прямой URL; пусто', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await app(`/t/${alta}/review`, { persona: 'manager' });
    await page
      .getByRole('navigation', { name: 'Связанные разделы' })
      .getByRole('button', { name: 'Очередь дефектов' })
      .click();
    await expect(page).toHaveURL(/\/defects$/);
    await expect(h1(page, H1)).toBeVisible();
    await expect(page.getByText('Блокирующих дефектов нет')).toBeVisible();
    await page.reload();
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('tab', { name: /На проверке/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('дефект на проверке: карточка; «разрешить выезд» → «Решённые»', async ({ app, page }) => {
    const { tenant } = await driverShift(app, page, { defect: true });
    await app(`/t/${tenant}/defects`, { persona: 'manager' });
    const c = card(page);
    await expect(c).toContainText('Рейс Р-208 · Илья Васильев');
    await expect(c).toContainText('ГАЗель Next · А 412 МР 77');
    await expect(c).toContainText('Отмечен при осмотре перед выездом 01.10.2026 в');
    await c.getByRole('button', { name: 'Дефект некритичный — разрешить выезд' }).click();
    await expect(toast(page)).toHaveText('Выезд разрешён');
    await expect(page.getByText('Блокирующих дефектов нет')).toBeVisible();
    await page.getByRole('tab', { name: /Решённые/ }).click();
    await expect(card(page)).toContainText('Выезд разрешён');
    await expect(page).toHaveURL(/tab=decided/);
  });

  test('«Подтвердить неисправность» с комментарием', async ({ app, page }) => {
    const { tenant } = await driverShift(app, page, { defect: true });
    await app(`/t/${tenant}/defects`, { persona: 'manager' });
    const c = card(page);
    await c.getByLabel('Комментарий к решению').fill('Трещина через всё стекло');
    await c.getByRole('button', { name: 'Подтвердить неисправность' }).click();
    await expect(toast(page)).toHaveText('Неисправность подтверждена, машина снята с рейса');
    await page.getByRole('tab', { name: /Решённые/ }).click();
    await expect(card(page)).toContainText('Неисправность подтверждена');
    await expect(card(page)).toContainText('Трещина через всё стекло');
    const v = await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/vehicles?limit=200`);
    const gazel = (v.body as { items: { displayName: string; status: string }[] }).items.find(
      (x) => x.displayName === 'ГАЗель Next',
    );
    expect(gazel?.status).toBe('maintenance');
  });

  test('дефект уже решён другим: 409 — тост и перечитывание', async ({ app, page }) => {
    const { tenant } = await driverShift(app, page, { defect: true });
    await app(`/t/${tenant}/defects`, { persona: 'manager' });
    await expect(card(page)).toBeVisible();
    // Другой менеджер (владелец) решает дефект в своей сессии «за спиной» экрана.
    const list = await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/defects?state=in_review`);
    const d = (list.body as { items: { id: string }[] }).items[0];
    const cur = await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/defects/${d?.id ?? ''}`);
    const r = await call(
      page,
      'POST',
      `/api/v1/tenants/${tenant}/fleet/defects/${d?.id ?? ''}/decision`,
      {
        body: { decision: 'allow_departure' },
        ifMatch: cur.headers.etag ?? '',
      },
    );
    expect(r.status).toBe(200);
    await card(page).getByRole('button', { name: 'Подтвердить неисправность' }).click();
    await expect(toast(page)).not.toHaveText('');
    await expect(page.getByText('Блокирующих дефектов нет')).toBeVisible();
  });

  test('ошибка загрузки — «Повторить»', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await devScenario(page, { scenario: 'listInspectionDefects=rate_limited' });
    await app(`/t/${alta}/defects`, { persona: 'manager' });
    await expect(page.getByText(/^Не удалось загрузить дефекты: /)).toHaveText(
      'Не удалось загрузить дефекты: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: null });
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByText('Блокирующих дефектов нет')).toBeVisible();
  });

  test('водитель: гейт «Нет роли с доступом»', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await app(`/t/${alta}/defects`, { persona: 'driver' });
    await expect(page.getByText(/Нет роли с доступом/)).toBeVisible();
  });

  test('крошка владельца; загрузка — скелетон; 1440 — боковая панель, 390 — нижняя навигация', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await devScenario(page, { scenario: 'listInspectionDefects=delay=1500' });
    await app(`/t/${alta}/defects`, { persona: 'owner' });
    await expect(page.getByRole('main').getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await devScenario(page, { scenario: null });
    await expect(page.getByText('Блокирующих дефектов нет')).toBeVisible();
    await expect(page.locator('section[aria-labelledby="h-defects"] .ox-rv-crumb')).toHaveText(
      'Альта Групп · все подразделения',
    );
    if (phone(page)) {
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeHidden();
    } else {
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeHidden();
    }
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('нет связи: тост «нет связи», дефект остаётся на проверке', async ({ app, page }) => {
    const { tenant } = await driverShift(app, page, { defect: true });
    await app(`/t/${tenant}/defects`, { persona: 'manager' });
    await expect(card(page)).toBeVisible();
    await devScenario(page, { scenario: 'decideInspectionDefect=offline' });
    await card(page).getByRole('button', { name: 'Подтвердить неисправность' }).click();
    await expect(toast(page)).toHaveText(OFFLINE);
    await devScenario(page, { scenario: null });
    await expect(card(page)).toBeVisible();
    await expect(
      card(page).getByRole('button', { name: 'Подтвердить неисправность' }),
    ).toBeEnabled();
    await expect(page.getByRole('tab', { name: /На проверке/ })).toContainText('1');
  });

  test('организация только для чтения: команды карточки недоступны', async ({ app, page }) => {
    const { tenant } = await driverShift(app, page, { defect: true });
    await app('/', { persona: 'owner' });
    await devScenario(page, { preset: 'trial-ended' });
    await app(`/t/${tenant}/defects`, { persona: 'manager' });
    const c = card(page);
    await expect(c).toBeVisible();
    for (const name of ['Дефект некритичный — разрешить выезд', 'Подтвердить неисправность']) {
      await expect(c.getByRole('button', { name })).toBeDisabled();
    }
    await expect(c.getByLabel('Комментарий к решению')).toBeDisabled();
  });

  test('клавиатура: Tab до вкладки, фокус виден, стрелки переключают; Tab до команды', async ({
    app,
    page,
  }) => {
    const { tenant } = await driverShift(app, page, { defect: true });
    await app(`/t/${tenant}/defects`, { persona: 'manager' });
    await expect(card(page)).toBeVisible();
    const review = page.getByRole('tab', { name: /На проверке/ });
    const decided = page.getByRole('tab', { name: /Решённые/ });
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await review.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(await review.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.keyboard.press('ArrowRight');
    await expect(decided).toHaveAttribute('aria-selected', 'true');
    await expect(decided).toBeFocused();
    await expect(page).toHaveURL(/tab=decided/);
    await page.keyboard.press('ArrowLeft');
    await expect(review).toHaveAttribute('aria-selected', 'true');
    await expect(review).toBeFocused();
    const confirm = card(page).getByRole('button', { name: 'Подтвердить неисправность' });
    reached = false;
    for (let i = 0; i < 10 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await confirm.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(await confirm.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  });

  // W2.46 (D-29 комплекта): исполнитель и срок решения — assignInspectionDefect. Кандидаты — listMembers в области
  // members.read: владелец видит всех и назначает; менеджер видит исполнителя на карточке.
  test('W2.46: владелец назначает исполнителя и срок; менеджер видит их на карточке', async ({
    app,
    page,
    axe,
  }) => {
    const { tenant } = await driverShift(app, page, { defect: true });
    await app(`/t/${tenant}/defects`, { persona: 'owner' });
    const c = card(page);
    await expect(c).toContainText('Исполнитель не назначен');
    const submit = c.getByRole('button', { name: 'Назначить' });
    await expect(submit).toBeDisabled();
    await c.getByLabel('Исполнитель').selectOption({ label: 'Марина Котова' });
    await c.getByLabel('Срок решения').fill('2030-10-02T12:00');
    if (phone(page)) {
      for (const field of [c.getByLabel('Исполнитель'), c.getByLabel('Срок решения'), submit]) {
        expect(await hitHeight(field)).toBeGreaterThanOrEqual(44);
      }
    }
    expect(await noHorizontalScroll(page)).toBe(true);
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious.map((v) => v.id)).toEqual([]);
    await submit.click();
    await expect(toast(page)).toHaveText('Исполнитель назначен');
    await expect(c).toContainText('Исполнитель: Марина Котова · срок 02.10.2030 в 12:00');
    await app(`/t/${tenant}/defects`, { persona: 'manager' });
    await expect(card(page)).toContainText('Исполнитель: Марина Котова · срок 02.10.2030 в 12:00');
  });

  test('390: цели не меньше 44 px, без горизонтальной прокрутки; axe без serious', async ({
    app,
    page,
    axe,
  }) => {
    const { tenant } = await driverShift(app, page, { defect: true });
    await app(`/t/${tenant}/defects`, { persona: 'manager' });
    await expect(card(page)).toBeVisible();
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious.map((v) => v.id)).toEqual([]);
    if (!phone(page)) return;
    for (const name of [
      'Дефект некритичный — разрешить выезд',
      'Подтвердить неисправность',
      'Открыть в «Приёмке смен»',
    ]) {
      expect(await hitHeight(card(page).getByRole('button', { name }))).toBeGreaterThanOrEqual(44);
    }
    expect(await hitHeight(page.getByRole('tab', { name: /Решённые/ }))).toBeGreaterThanOrEqual(44);
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

// W2.53: очередь дефектов (W2.04), брони (W2.02), рейсы (W2.03, W2.05) и приёмка (W2.06) в main — fixme снят. Сид
// e2e-stand («Логистика», роль логиста, второй водитель Тимур Ахмедов) и уборка — logistics.stand.ts.
test.describe('logistics-defects — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('менеджер на стенде: очередь по listInspectionDefects стенда, вкладки', async ({
    app,
    page,
    session,
    undo,
  }) => {
    test.slow();
    await realClock(page);
    const s = await logisticsOn(session, undo);
    await app(`/t/${s.tenant}/defects`, { persona: 'manager' });
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('tab', { name: /На проверке/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const r = await call(page, 'GET', `/api/v1/tenants/${s.tenant}/fleet/defects?state=in_review`);
    expect(r.status).toBe(200);
    const waiting = (r.body as { items: unknown[] }).items.length;
    if (waiting === 0) await expect(page.getByText('Блокирующих дефектов нет')).toBeVisible();
    else await expect(page.locator('article')).toHaveCount(waiting);
    await page.getByRole('tab', { name: /Решённые/ }).click();
    await expect(page).toHaveURL(/tab=decided/);
  });

  test('менеджер на стенде решает блокирующий дефект: «разрешить выезд» → «Решённые»', async ({
    app,
    page,
    session,
    undo,
    harness,
  }, testInfo) => {
    test.setTimeout(300_000);
    await realClock(page);
    const s = await logisticsOn(session, undo, { akhmedov: true });
    const driver = await akhmedov(session);
    await app(`/t/${s.tenant}/defects`, { persona: 'manager' });
    const trip = await newTrip(page, s, {
      title: `Стенд ${label(testInfo.project.name)}`,
      driverMemberId: s.members.akhmedov,
    });
    test.skip(!(await storageReachable(driver, s.tenant, trip.id, harness.allowHosts)), NO_STORAGE);
    undo(`бронь рейса ${trip.number}`, () => closeTrip(driver, page, s.tenant, trip.id));
    const shift = await apiDeparture(driver, s.tenant, trip, { defect: true });
    await page.reload();
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    const mine = page.locator('article').filter({ hasText: `Рейс ${trip.number} · ${AKHMEDOV}` });
    await expect(mine.getByRole('heading', { level: 2, name: 'Стёкла: Скол' })).toBeVisible();
    await expect(mine).toContainText(`${GAZEL} · ${shift.vehicle.registrationNumber}`);
    await expect(mine).toContainText('Отмечен при осмотре перед выездом');
    await mine.getByRole('button', { name: 'Дефект некритичный — разрешить выезд' }).click();
    await expect(toast(page)).toHaveText('Выезд разрешён', { timeout: 15_000 });
    await expect(mine).toHaveCount(0);
    await page.getByRole('tab', { name: /Решённые/ }).click();
    await expect(mine).toContainText('Выезд разрешён');
    // Смена закрывается: выезд, сдача и приёмка — рейс не остаётся активным для следующего проекта.
    await apiStart(driver, s.tenant, shift);
    await apiReturn(driver, s.tenant, trip, shift);
    await approve(page, s.tenant, trip.id);
  });
});
