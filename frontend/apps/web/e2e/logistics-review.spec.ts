// W2.21 · e2e страницы `logistics-review` «Приёмка смен» и диалога `modal-accept-shift` (S2-10, S2-11, S2-12, S2-17;
// эталон design-stage-2 · Ортус CRM.dc.html pg.review :566–662, reviewVM :3330–3382, accept/rework/decideDefect
// :2764–2786; чек-лист 03-logistics.md §14 п. 41–47). Обязательные пункты verification-protocol §1.3. Смена водителя
// готовится через API (logistics-review.helpers.ts), решения менеджер принимает на экране.
import { expect, test } from './_stand/fixtures.ts';
import {
  driverShift,
  fromMenu,
  phone,
  queueItem,
  REVIEW_H1,
  review,
  statValue,
} from './logistics-review.helpers.ts';
import {
  akhmedov,
  AKHMEDOV,
  apiShift,
  closeTrip,
  label,
  logisticsOn,
  newTrip,
  NO_STORAGE,
  plan,
  plans,
  realClock,
  storageReachable,
  UNIT,
  vehicle,
} from './logistics.stand.ts';
import { h1, hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import { call, devScenario, tenantId } from './shell.helpers.ts';

const nb = (s: string): string => s.replace(/(\d) (\d{3})/g, '$1\u00a0$2');
const INTRO =
  'Фото до и после, пробег, дефекты и расходы. Машина возвращается в пул свободных только после приёмки.';
const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';

test.describe('logistics-review — «Приёмка смен» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');
  // Смена водителя через API (~40 запросов) и проверки экрана — больше 30 с по умолчанию.
  test.setTimeout(90_000);

  test('меню «Логистика» → «Приёмка смен» и прямой URL: крошка, заголовок, пояснение', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await app(`/t/${alta}/home`, { persona: 'manager' });
    await fromMenu(page, REVIEW_H1, 'Приёмка');
    await expect(page).toHaveURL(/\/review$/);
    await expect(h1(page, REVIEW_H1)).toBeVisible();
    await expect(review(page).getByText(INTRO)).toBeVisible();
    await expect(review(page).locator('.ox-rv-crumb')).toContainText('Север Логистик');
    await page.reload();
    // Перезагрузка — новый вход в сборку и MSW worker: дольше обычного ожидания.
    await expect(h1(page, REVIEW_H1)).toBeVisible({ timeout: 15_000 });
  });

  test('нет сданных смен: «Нет смен на проверке» с подсказкой (п. 41)', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await app(`/t/${alta}/review`, { persona: 'owner' });
    await expect(review(page).locator('.ox-rv-crumb')).toHaveText(
      'Альта Групп · все подразделения',
    );
    await expect(review(page).getByText('Нет смен на проверке')).toBeVisible();
    await expect(
      review(page).getByText(
        'Когда водитель сдаст машину, смена появится здесь. В демо переключитесь на водителя и пройдите смену.',
      ),
    ).toBeVisible();
  });

  test('смена сдана: очередь, статистика, фото до и после, расходы и итог (п. 42)', async ({
    app,
    page,
  }) => {
    const { tenant } = await driverShift(app, page);
    await app(`/t/${tenant}/review`, { persona: 'manager' });
    const item = queueItem(page);
    await expect(item).toHaveAttribute('aria-pressed', 'true');
    await expect(item).toContainText('Р-208 · Илья Васильев');
    await expect(item).toContainText('ГАЗель Next · А 412 МР 77');
    await expect(item).toContainText('Ожидает приёмки');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Р-208 · Северный маршрут' }),
    ).toBeVisible();
    await expect(statValue(page, 'Пробег при выезде')).toHaveText(nb('84 500 км'));
    await expect(statValue(page, 'При сдаче')).toHaveText(nb('84 560 км'));
    await expect(statValue(page, 'Пройдено')).toHaveText('60 км');
    await expect(statValue(page, 'Топливо')).toHaveText('½ → ½');
    await expect(page.getByRole('heading', { level: 3, name: 'Фото до и после' })).toBeVisible();
    await expect(page.locator('.ox-rv-thumb')).toHaveCount(10);
    await expect(page.locator('.ox-rv-thumb-tag', { hasText: 'фото' })).toHaveCount(10);
    await expect(page.getByText('Осмотр при сдаче: чек-лист заполнен')).toBeVisible();
    const exp = page.locator('.ox-rv-expense');
    await expect(exp).toHaveCount(1);
    await expect(exp).toContainText('Топливо');
    await expect(exp).toContainText('01.10.2026 · АЗС на Ленинградском шоссе · чек приложен');
    await expect(exp).toContainText(nb('2 500 ₽'));
    await expect(page.locator('.ox-rv-total')).toContainText(nb('2 500 ₽'));
  });

  test('расходы «Шиномонтаж и мелкий ремонт» и «Прочее» (0.5.1-stage2): строки, итог, приёмка', async ({
    app,
    page,
  }) => {
    const { tenant } = await driverShift(app, page, { kinds: ['tire_service', 'other'] });
    await app(`/t/${tenant}/review`, { persona: 'manager' });
    const exp = page.locator('.ox-rv-expense');
    await expect(exp).toHaveCount(3);
    await expect(exp.locator('.ox-rv-expense-label')).toHaveText([
      'Топливо',
      'Шиномонтаж и мелкий ремонт',
      'Прочее',
    ]);
    await expect(exp.nth(2)).toContainText('01.10.2026 · Ключи от склада · чек приложен');
    await expect(page.locator('.ox-rv-total')).toContainText(nb('4 900 ₽'));
    await page.getByRole('button', { name: 'Принять смену' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Принять смену' }).click();
    await expect(toast(page)).toHaveText('Смена принята. Машина вернулась в пул');
    await expect(exp).toHaveCount(3);
  });

  test('«Вернуть на доработку»: проверки, тост, чип и итог (п. 44)', async ({ app, page }) => {
    const { tenant } = await driverShift(app, page);
    await app(`/t/${tenant}/review`, { persona: 'manager' });
    const rework = page.getByRole('button', { name: 'Вернуть на доработку' });
    await rework.click();
    await expect(page.getByRole('alert').filter({ hasText: 'Опишите' })).toContainText(
      'Опишите, что нужно исправить',
    );
    await page
      .getByLabel('Замечания для водителя')
      .fill('Переснимите фото слева — не виден бампер');
    await rework.click();
    await expect(page.getByRole('alert').filter({ hasText: 'Отметьте' })).toContainText(
      'Отметьте хотя бы один раздел для доработки',
    );
    await page.getByRole('checkbox', { name: 'Фото при сдаче' }).check();
    await rework.click();
    await expect(toast(page)).toHaveText('Смена возвращена водителю на доработку');
    await expect(page.getByRole('status').filter({ hasText: 'Возвращено водителю' })).toContainText(
      'Возвращено водителю: «Переснимите фото слева — не виден бампер». Исправить: Фото при сдаче.',
    );
    await expect(queueItem(page)).toContainText('На доработке');
    await expect(page.getByRole('button', { name: 'Принять смену' })).toHaveCount(0);
  });

  test('«Принять смену»: диалог «Что произойдёт», тост, итог, машина свободна (п. 46)', async ({
    app,
    page,
  }) => {
    const { tenant } = await driverShift(app, page);
    await app(`/t/${tenant}/review`, { persona: 'manager' });
    const accept = page.getByRole('button', { name: 'Принять смену' });
    await accept.click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByRole('heading', { name: 'Принять смену Р-208?' })).toBeVisible();
    await expect(dlg).toContainText('Осмотр, пробег и расходы будут подтверждены.');
    await expect(dlg).toContainText('Что произойдёт');
    await expect(dlg).toContainText('Машина вернётся в пул свободных');
    await expect(dlg).toContainText(
      'Расходы станут принятыми; кассовые операции создаются отдельно',
    );
    await expect(dlg).toContainText(
      'Будет создано начисление водителю. Его видят владелец и уполномоченный менеджер',
    );
    await dlg.getByRole('button', { name: 'Принять смену' }).click();
    await expect(toast(page)).toHaveText('Смена принята. Машина вернулась в пул');
    await expect(dlg).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Смена принята в' })).toHaveText(
      /Смена принята в \d\d:\d\d\. Машина вернулась в пул свободных\.$/,
    );
    await expect(queueItem(page)).toContainText('Принят');
    const v = await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/vehicles?limit=200`);
    const gazel = (
      v.body as { items: { displayName: string; status: string; odometerKm: string }[] }
    ).items.find((x) => x.displayName === 'ГАЗель Next');
    expect(gazel?.status).toBe('available');
    expect(gazel?.odometerKm).toBe('84560');
  });

  test('владелец: начисление после приёмки — «4 500 ₽» (п. 43)', async ({ app, page }) => {
    const { tenant } = await driverShift(app, page);
    await app(`/t/${tenant}/review`, { persona: 'owner' });
    await page.getByRole('button', { name: 'Принять смену' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Принять смену' }).click();
    await expect(toast(page)).toHaveText('Смена принята. Машина вернулась в пул');
    const earn = page.locator('.ox-rv-earn');
    await expect(earn).toContainText('Начисление водителю за рейс');
    await expect(earn).toContainText(
      'Видно владельцу и менеджеру с правом fleet.earnings.read в своей области. Водителю не показывается и не передаётся.',
    );
    await expect(earn).toContainText(nb('4 500 ₽'));
  });

  test('критический дефект первым в очереди; «разрешить выезд» (п. 47)', async ({ app, page }) => {
    const { tenant } = await driverShift(app, page, { defect: true });
    await app(`/t/${tenant}/review`, { persona: 'manager' });
    const card = page
      .getByRole('alert')
      .filter({ has: page.getByRole('heading', { level: 2, name: /Критический дефект/ }) });
    await expect(card.getByRole('heading', { level: 2 })).toHaveText(
      'Критический дефект · ГАЗель Next А 412 МР 77',
    );
    await expect(card).toContainText('Р-208 · Илья Васильев · осмотр в');
    await expect(card).toContainText('Стёкла: Скол');
    await expect(queueItem(page)).toContainText('Дефект на проверке');
    await card.getByRole('button', { name: 'Дефект некритичный — разрешить выезд' }).click();
    await expect(toast(page)).toHaveText('Выезд разрешён');
    await expect(review(page).getByText('Нет смен на проверке')).toBeVisible();
    const t = await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/trip-plans?limit=200`);
    const r208 = (t.body as { items: { number: string; state: string }[] }).items.find(
      (x) => x.number === 'Р-208',
    );
    expect(r208?.state).toBe('inspection');
  });

  test('критический дефект: «Подтвердить неисправность» (п. 47)', async ({ app, page }) => {
    const { tenant } = await driverShift(app, page, { defect: true });
    await app(`/t/${tenant}/review`, { persona: 'manager' });
    await page.getByRole('button', { name: 'Подтвердить неисправность' }).click();
    await expect(toast(page)).toHaveText('Неисправность подтверждена, машина снята с рейса');
    await expect(review(page).getByText('Нет смен на проверке')).toBeVisible();
    const v = await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/vehicles?limit=200`);
    const gazel = (
      v.body as { items: { displayName: string; status: string; statusNote?: string }[] }
    ).items.find((x) => x.displayName === 'ГАЗель Next');
    expect(gazel?.status).toBe('maintenance');
    expect(gazel?.statusNote).toBe('неисправность подтверждена');
  });

  test('загрузка — скелетон; ошибка — «Повторить»', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await devScenario(page, { scenario: 'listTripPlans=rate_limited' });
    await app(`/t/${alta}/review`, { persona: 'owner' });
    await expect(page.getByText(/^Не удалось загрузить смены: /)).toHaveText(
      'Не удалось загрузить смены: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: 'listTripPlans=delay=1500' });
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByRole('main').getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await devScenario(page, { scenario: null });
    await expect(review(page).getByText('Нет смен на проверке')).toBeVisible();
  });

  test('нет связи: тост «нет связи», смена остаётся на проверке', async ({ app, page }) => {
    const { tenant } = await driverShift(app, page);
    await app(`/t/${tenant}/review`, { persona: 'manager' });
    await expect(queueItem(page)).toContainText('Ожидает приёмки');
    await devScenario(page, { scenario: 'reviewTrip=offline' });
    await page.getByRole('button', { name: 'Принять смену' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Принять смену' }).click();
    await expect(toast(page)).toHaveText(OFFLINE);
    await devScenario(page, { scenario: null });
    await expect(queueItem(page)).toContainText('Ожидает приёмки');
  });

  test('организация только для чтения: решения недоступны', async ({ app, page }) => {
    const { tenant } = await driverShift(app, page);
    await app('/', { persona: 'owner' });
    await devScenario(page, { preset: 'trial-ended' });
    await app(`/t/${tenant}/review`, { persona: 'manager' });
    await expect(page.getByRole('button', { name: 'Принять смену' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Вернуть на доработку' })).toBeDisabled();
  });

  test('водитель: гейт «Нет права на приёмку смен»', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await app(`/t/${alta}/review`, { persona: 'driver' });
    await expect(page.getByText('Нет права на приёмку смен')).toBeVisible();
  });

  test('клавиатура: Escape закрывает диалог, фокус возвращается; axe без serious', async ({
    app,
    page,
    axe,
  }) => {
    const { tenant } = await driverShift(app, page);
    await app(`/t/${tenant}/review`, { persona: 'manager' });
    const accept = page.getByRole('button', { name: 'Принять смену' });
    await accept.focus();
    await page.keyboard.press('Enter');
    const dlg = page.getByRole('dialog');
    await expect(dlg).toBeVisible();
    // Escape ловит модальное окно React Aria, когда фокус уже внутри него (перенос фокуса — после открытия).
    await expect
      .poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')))
      .toBe(true);
    // axe — в открытом диалоге «Принять смену» (до Escape), затем на экране после закрытия.
    const inDialog = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(inDialog.map((v) => v.id)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(accept).toBeFocused();
    const r = await axe(page);
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => v.id)).toEqual([]);
  });

  test('390: нижняя навигация, цели не меньше 44 px, без горизонтальной прокрутки', async ({
    app,
    page,
  }) => {
    test.skip(!phone(page), 'только телефон');
    const { tenant } = await driverShift(app, page);
    await app(`/t/${tenant}/review`, { persona: 'manager' });
    await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeVisible();
    await expect(queueItem(page)).toBeVisible();
    for (const name of ['Вернуть на доработку', 'Принять смену']) {
      expect(await hitHeight(page.getByRole('button', { name }))).toBeGreaterThanOrEqual(44);
    }
    expect(await hitHeight(queueItem(page))).toBeGreaterThanOrEqual(44);
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

// W2.53: рейсы (W2.03, W2.05) и приёмка (W2.06, reviewTrip) в main — fixme снят. Сид e2e-stand («Логистика», роль
// логиста, второй водитель Тимур Ахмедов) и уборка — logistics.stand.ts.
test.describe('logistics-review — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('менеджер на стенде: «Приёмка смен» по listTripPlans стенда, крошка области', async ({
    app,
    page,
    session,
    undo,
  }) => {
    test.slow();
    await realClock(page);
    const s = await logisticsOn(session, undo);
    await app(`/t/${s.tenant}/review`, { persona: 'manager' });
    await expect(h1(page, REVIEW_H1)).toBeVisible({ timeout: 15_000 });
    await expect(review(page).getByText(INTRO)).toBeVisible();
    await expect(review(page).locator('.ox-rv-crumb')).toContainText(UNIT);
    // Очередь — сданные смены и уже решённые (принятые, на доработке); пусто — подсказка эталона (п. 41).
    const all = await plans(page, s.tenant);
    const queue = all.filter((p) => ['submitted', 'rework', 'accepted'].includes(p.state));
    if (queue.length === 0) {
      await expect(review(page).getByText('Нет смен на проверке')).toBeVisible();
    }
    for (const p of all.filter((x) => x.state === 'submitted')) {
      await expect(queueItem(page, p.number)).toContainText('Ожидает приёмки');
    }
  });

  test('менеджер на стенде принимает смену водителя: очередь, «Принять смену», машина в пуле', async ({
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
    await app(`/t/${s.tenant}/review`, { persona: 'manager' });
    const trip = await newTrip(page, s, {
      title: `Стенд ${label(testInfo.project.name)}`,
      driverMemberId: s.members.akhmedov,
    });
    test.skip(!(await storageReachable(driver, s.tenant, trip.id, harness.allowHosts)), NO_STORAGE);
    undo(`бронь рейса ${trip.number}`, () => closeTrip(driver, page, s.tenant, trip.id));
    const shift = await apiShift(driver, s.tenant, trip);
    await page.reload();
    await expect(h1(page, REVIEW_H1)).toBeVisible({ timeout: 15_000 });
    const item = queueItem(page, trip.number);
    await expect(item).toContainText(`${trip.number} · ${AKHMEDOV}`);
    await expect(item).toContainText('Ожидает приёмки');
    await item.click();
    await page.getByRole('button', { name: 'Принять смену' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByRole('heading', { name: `Принять смену ${trip.number}?` })).toBeVisible();
    await expect(dlg).toContainText('Машина вернётся в пул свободных');
    await dlg.getByRole('button', { name: 'Принять смену' }).click();
    await expect(toast(page)).toHaveText('Смена принята. Машина вернулась в пул', {
      timeout: 15_000,
    });
    await expect(dlg).toBeHidden();
    await expect(queueItem(page, trip.number)).toContainText('Принят');
    const done = (await plan(page, s.tenant, trip.id)).body as { state: string };
    expect(done.state).toBe('accepted');
    // Пробег сдачи стал пробегом машины. Статус машины не проверяется: бронь смены, начатой до своего окна, держит
    // машину до конца окна и после приёмки (вопрос W2.53).
    expect((await vehicle(page, s.tenant)).odometerKm).toBe(
      String(Number(shift.vehicle.odometerKm) + 190),
    );
  });
});
