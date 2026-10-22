// W2.73 · e2e диалога `modal-driver-request` «Запросить водителя» с блоком «Машина» (S2-20, D-35; эталон
// design-2026-10-19b · «Временный водитель - варианты.dc.html» 1a :142–185, renderVals :516–569). Режимы:
// «Наша + можно свою» (host_or_home), «Только наша» (host), «Своя машина водителя» (home); обычная машина не
// подходит (tweak homeCarFits) — красная рамка, «Отправить запрос» недоступна в режиме «своя», галочка недоступна.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import {
  apiRequest,
  driverCard,
  OFFLINE,
  openPool,
  phone,
  POOL_H1,
} from './logistics-pool.helpers.ts';
import { HD, HD_PLATE, patchUsual, textLines } from './logistics-pool-s220.helpers.ts';
import {
  esc,
  hostModel,
  openRequest,
  s220Stand,
  transferOf,
  USUAL,
  YUG,
} from './logistics-pool-s220.stand.ts';
import { realClock } from './logistics.stand.ts';
import { h1, hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import { call, devScenario } from './shell.helpers.ts';

type AppFn = Parameters<typeof openPool>[0];

/** Пул логиста Котовой; Водитель #104 — с обычной машиной Hyundai HD-35 (`fits=false` — без охлаждения). */
async function openWithUsual(app: AppFn, page: Page, fits = true): Promise<string> {
  const alta = await openPool(app, page);
  await patchUsual(page, alta, fits);
  await app(`/t/${alta}/pool`, { persona: 'manager' });
  await driverCard(page, 'Водитель #104').getByRole('button').waitFor();
  return alta;
}

const open = async (page: Page, code = 'Водитель #104'): Promise<Locator> => {
  await driverCard(page, code).getByRole('button', { name: 'Запросить на рейс Р-211' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  return dlg;
};

const value = (dlg: Locator, term: string): Locator =>
  dlg.locator('dt', { hasText: new RegExp(`^${term}$`) }).locator('xpath=following-sibling::dd[1]');

const radio = (dlg: Locator, name: string): Locator => dlg.getByRole('radio', { name });
const choice = (dlg: Locator): Locator =>
  dlg.getByRole('checkbox', { name: /Можно взять свою обычную/ });
const summary = (dlg: Locator): Locator => dlg.locator('.ox-pl-sum-line > span:last-child');

interface TransferLike {
  vehicle?: {
    mode: string;
    hostVehicle?: { displayName: string };
    homeVehicle?: { displayName: string };
  };
}

const outgoing = async (page: Page, tenant: string): Promise<TransferLike[]> =>
  (
    (
      await call(
        page,
        'GET',
        `/api/v1/tenants/${tenant}/fleet/driver-transfer-requests?direction=outgoing&limit=200`,
      )
    ).body as { items: TransferLike[] }
  ).items;

test.describe('modal-driver-request — машина для временного водителя (1a) @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');
  test.setTimeout(90_000);

  test('по умолчанию «Наша + можно свою»: строки, варианты, итог; запрос host_or_home', async ({
    app,
    page,
  }) => {
    const alta = await openWithUsual(app, page);
    const dlg = await open(page);
    await expect(dlg).toContainText('Водитель #104 · Юг Транс · Кат. C · рефрижератор');
    await expect(value(dlg, 'Рейс')).toHaveText(
      'Р-211 · Охлаждённая продукция · 01.10, 14:00–18:00',
    );
    await expect(value(dlg, 'Груз')).toHaveText('0,6 т · 7 м³ · кузов от 2,4 м · +2…+6 °C');
    await expect(value(dlg, 'Доступ')).toHaveText('С одобрения до 18:00, только этот рейс');
    await expect(value(dlg, 'Согласует')).toHaveText('Менеджер фирмы Юг Транс');
    await expect(dlg.getByRole('radiogroup', { name: 'Машина' })).toBeVisible();
    await expect(radio(dlg, 'Едет на своей обычной')).toHaveAttribute('aria-checked', 'false');
    await expect(radio(dlg, 'Ставим нашу машину')).toHaveAttribute('aria-checked', 'true');
    await expect(dlg).toContainText(`${HD} · ${HD_PLATE} · Юг Транс`);
    await expect(dlg).toContainText('Рефрижератор · 1,8 т · 13 м³ · кузов 3,6 м · −10…+10 °C');
    await expect(dlg).toContainText('Подходит рейсу · свободна 14:00–18:00');
    await expect(dlg).toContainText('Машину тоже согласует Юг Транс.');
    await expect(dlg.getByRole('combobox', { name: 'Ставим нашу машину' })).toHaveValue(/.+/);
    await expect(dlg.locator('.ox-pl-select-value')).toHaveText('Ford Transit · М 608 КТ 77');
    await expect(dlg).toContainText('Рейсу подходит 1 из 4 свободных машин Север Логистик.');
    await expect(choice(dlg)).toHaveAttribute('aria-checked', 'true');
    await expect(choice(dlg)).toContainText(
      'Водитель выберет в день рейса до 13:30: Ford Transit или свою Hyundai HD-35.',
    );
    await expect(dlg.getByText('Что произойдёт после одобрения')).toBeVisible();
    await expect(summary(dlg)).toHaveText([
      'Две брони до выбора на 14:00–18:00: Ford Transit и Hyundai HD-35. До рейса Hyundai работает в Юг Транс.',
      'Водитель выберет машину до 13:30. Вторая бронь снимется сразу.',
      'Не выберет — останется Ford Transit, Hyundai вернётся в Юг Транс.',
      'Доступ водителя — только к рейсу Р-211 до 18:00. История и начисления остаются в Юг Транс.',
    ]);
    await expect(dlg.getByLabel('Комментарий для фирмы-владельца')).toHaveAttribute(
      'placeholder',
      'Необязательно',
    );
    await dlg.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(toast(page)).toHaveText('Запрос отправлен фирме Юг Транс');
    await expect(dlg).toBeHidden();
    const [x] = await outgoing(page, alta);
    expect(x?.vehicle).toMatchObject({
      mode: 'host_or_home',
      hostVehicle: { displayName: 'Ford Transit' },
      homeVehicle: { displayName: HD },
    });
  });

  test('«Только наша»: галочка снята — бронь Ford Transit; запрос host', async ({ app, page }) => {
    const alta = await openWithUsual(app, page);
    const dlg = await open(page);
    await choice(dlg).click();
    await expect(choice(dlg)).toHaveAttribute('aria-checked', 'false');
    await expect(summary(dlg)).toHaveText([
      'Бронь Ford Transit на 14:00–18:00.',
      'Водителю нечего подтверждать: он сразу начинает осмотр.',
      'Доступ водителя — только к рейсу Р-211 до 18:00. История и начисления остаются в Юг Транс.',
    ]);
    await dlg.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(toast(page)).toHaveText('Запрос отправлен фирме Юг Транс');
    expect((await outgoing(page, alta))[0]?.vehicle?.mode).toBe('host');
  });

  test('«Своя машина водителя»: вариант 1 — бронь обычной; запрос home', async ({ app, page }) => {
    const alta = await openWithUsual(app, page);
    const dlg = await open(page);
    await radio(dlg, 'Едет на своей обычной').click();
    await expect(radio(dlg, 'Едет на своей обычной')).toHaveAttribute('aria-checked', 'true');
    await expect(radio(dlg, 'Ставим нашу машину')).toHaveAttribute('aria-checked', 'false');
    await expect(summary(dlg).first()).toHaveText(
      'Бронь Hyundai HD-35 на 14:00–18:00, если Юг Транс одобрит машину.',
    );
    await expect(summary(dlg).nth(1)).toHaveText(
      'Одобрят только водителя — рейс попадёт в «Требует решения», машину поставите вы.',
    );
    await dlg.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(toast(page)).toHaveText('Запрос отправлен фирме Юг Транс');
    expect((await outgoing(page, alta))[0]?.vehicle).toMatchObject({
      mode: 'home',
      homeVehicle: { displayName: HD },
    });
  });

  test('обычная не подходит: причина, галочка недоступна, «своя» блокирует отправку', async ({
    app,
    page,
  }) => {
    const alta = await openWithUsual(app, page, false);
    const dlg = await open(page);
    await expect(dlg).toContainText('Фургон · 1,8 т · 13 м³ · кузов 3,6 м · без охлаждения');
    await expect(dlg).toContainText('Не подходит рейсу: нет охлаждения +2…+6 °C');
    await expect(choice(dlg)).toHaveAttribute('aria-disabled', 'true');
    await expect(choice(dlg)).toHaveAttribute('aria-checked', 'false');
    await expect(choice(dlg)).toContainText(
      'Недоступно: обычная машина не подходит рейсу, нет охлаждения.',
    );
    await expect(summary(dlg).first()).toHaveText('Бронь Ford Transit на 14:00–18:00.');
    await radio(dlg, 'Едет на своей обычной').click();
    const send = dlg.getByRole('button', { name: 'Отправить запрос' });
    await expect(send).toBeDisabled();
    await expect(summary(dlg).first()).toHaveText(
      'Обычная машина не подходит рейсу. Выберите «Ставим нашу машину».',
    );
    // Недоступная «Отправить запрос» — серая кнопка макета (sendBg/sendFg/sendBorder, renderVals :516–569).
    expect(
      await send.evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.backgroundColor, s.color, s.borderTopColor, s.opacity];
      }),
    ).toEqual(['rgb(236, 239, 234)', 'rgb(107, 120, 115)', 'rgb(220, 226, 217)', '1']);
    await radio(dlg, 'Ставим нашу машину').click();
    await dlg.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(toast(page)).toHaveText('Запрос отправлен фирме Юг Транс');
    expect((await outgoing(page, alta))[0]?.vehicle?.mode).toBe('host');
  });

  test('у водителя нет обычной машины: варианта 1 и галочки нет, запрос host', async ({
    app,
    page,
  }) => {
    const alta = await openPool(app, page);
    const dlg = await open(page, 'Водитель #117');
    await expect(radio(dlg, 'Едет на своей обычной')).toHaveCount(0);
    await expect(dlg.getByRole('checkbox')).toHaveCount(0);
    await expect(radio(dlg, 'Ставим нашу машину')).toHaveAttribute('aria-checked', 'true');
    await expect(summary(dlg).first()).toHaveText('Бронь Ford Transit на 14:00–18:00.');
    await dlg.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(toast(page)).toHaveText('Запрос отправлен фирме Восток Карго');
    expect((await outgoing(page, alta))[0]?.vehicle).toMatchObject({
      mode: 'host',
      hostVehicle: { displayName: 'Ford Transit' },
    });
  });

  test('клавиатура и 390: варианты и кнопки ≥ 44 px, без горизонтальной прокрутки', async ({
    app,
    page,
    axe,
  }) => {
    await openWithUsual(app, page);
    const dlg = await open(page);
    // Клавиатура: «своя» — Tab до варианта и Enter; галочка — Space.
    await radio(dlg, 'Едет на своей обычной').focus();
    await page.keyboard.press('Enter');
    await expect(radio(dlg, 'Едет на своей обычной')).toHaveAttribute('aria-checked', 'true');
    await radio(dlg, 'Ставим нашу машину').focus();
    await page.keyboard.press('Enter');
    await choice(dlg).focus();
    await page.keyboard.press('Space');
    await expect(choice(dlg)).toHaveAttribute('aria-checked', 'false');
    const bad = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(bad.map((v) => v.id)).toEqual([]);
    if (phone(page)) {
      for (const l of [
        radio(dlg, 'Едет на своей обычной'),
        radio(dlg, 'Ставим нашу машину'),
        choice(dlg),
        dlg.getByRole('button', { name: 'Отмена' }),
        dlg.getByRole('button', { name: 'Отправить запрос' }),
        dlg.getByRole('combobox', { name: 'Ставим нашу машину' }),
      ]) {
        expect(await hitHeight(l)).toBeGreaterThanOrEqual(44);
      }
      // Госномер не переносится («М 608 КТ 77» в одну строку).
      const lines = await dlg
        .locator('.ox-pl-mono')
        .evaluateAll((els) => els.map((el) => el.getClientRects().length));
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((n) => n === 1)).toBe(true);
      // Возврат 3 (ревью r3, minor): значение поля машины «Ford Transit · М 608 КТ 77» — одной строкой.
      expect(await textLines(dlg.locator('.ox-pl-select-value'))).toBe(1);
      expect(await noHorizontalScroll(page)).toBe(true);
    }
  });

  // Возврат 3 (ревью r3, major): список машин фирмы рейса (listVehicles) не загрузился или грузится — блок «Машина»
  // не пишет «Рейсу подходит 0 из 0 …» и не выбирает «своя» молча; «Отправить запрос» недоступна до загрузки.
  test('машины фирмы рейса не загрузились — role=alert с «Повторить», отправка недоступна; грузятся — скелетон', async ({
    app,
    page,
  }) => {
    const alta = await openPool(app, page);
    await patchUsual(page, alta, true);
    await devScenario(page, { scenario: 'listVehicles=offline' });
    await app(`/t/${alta}/pool`, { persona: 'manager' });
    await driverCard(page, 'Водитель #104').getByRole('button').waitFor();
    const dlg = await open(page);
    const alert = dlg.getByRole('alert');
    await expect(alert).toContainText('Не удалось загрузить машины фирмы рейса: ');
    await expect(dlg).not.toContainText('Рейсу подходит 0 из 0');
    await expect(dlg.getByRole('radio')).toHaveCount(0);
    const send = dlg.getByRole('button', { name: 'Отправить запрос' });
    await expect(send).toBeDisabled();
    await devScenario(page, { scenario: 'listVehicles=delay=4000' });
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(dlg.getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await expect(dlg).not.toContainText('Рейсу подходит 0 из 0');
    await expect(send).toBeDisabled();
    await expect(radio(dlg, 'Ставим нашу машину')).toHaveAttribute('aria-checked', 'true', {
      timeout: 15_000,
    });
    await expect(choice(dlg)).toHaveAttribute('aria-checked', 'true');
    await expect(dlg).toContainText('Рейсу подходит 1 из 4 свободных машин Север Логистик.');
    await devScenario(page, { scenario: null });
    await send.click();
    await expect(toast(page)).toHaveText('Запрос отправлен фирме Юг Транс');
    expect((await outgoing(page, alta))[0]?.vehicle?.mode).toBe('host_or_home');
  });

  // Возврат 3 (ревью r2–r3, minor): «Отправить запрос» недоступна на время отправки — браузер снимает с неё фокус
  // (на body). После ответа с ошибкой фокус возвращается в диалог, и Escape его закрывает. Ответ задержан (delay,
  // один раз), пока он в пути, тот же запрос уходит через API — задержанный получает 409 «Запрос уже отправлен».
  test('ошибка отправки после задержки (409): фокус в диалоге, Escape закрывает', async ({
    app,
    page,
  }) => {
    const alta = await openWithUsual(app, page);
    const dlg = await open(page);
    const send = dlg.getByRole('button', { name: 'Отправить запрос' });
    await devScenario(page, { scenario: 'requestDriverTransfer=delay=2500', once: true });
    await send.click();
    await expect(send).toBeDisabled();
    await apiRequest(page, alta);
    await expect(dlg.getByRole('alert')).toBeVisible({ timeout: 15_000 });
    await expect(send).toBeEnabled();
    await expect
      .poll(() => dlg.evaluate((el) => el.contains(document.activeElement)), {
        message: 'фокус внутри диалога',
      })
      .toBe(true);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
  });

  test('нет связи при отправке: тост, фокус в диалоге, Escape закрывает', async ({ app, page }) => {
    await openWithUsual(app, page);
    const dlg = await open(page);
    await devScenario(page, { scenario: 'requestDriverTransfer=offline' });
    await dlg.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(toast(page)).toHaveText(OFFLINE);
    await expect(dlg.getByRole('button', { name: 'Отправить запрос' })).toBeEnabled();
    expect(await dlg.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await devScenario(page, { scenario: null });
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
  });
});

// Стенд (контракт 0.6.3-stage2): водитель «Юг Транс» с обычной машиной Hyundai HD-35 (publishDriverToPool
// `usualVehicleId`), рейс «Север Логистик» логиста Котовой; машина фирмы рейса — первая подходящая свободная из сида.
test.describe('modal-driver-request — машина на стенде @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  test.setTimeout(180_000);

  test('логист на стенде: блок «Машина» — обычная машина водителя и наша, запрос «Наша + можно свою»', async ({
    app,
    page,
    session,
    undo,
  }, testInfo) => {
    await realClock(page);
    const s = await s220Stand(session, undo, testInfo.project.name);
    await app(`/t/${s.tenant}/pool?trip=${s.trip.id}`, { persona: 'manager' });
    await expect(h1(page, POOL_H1)).toBeVisible({ timeout: 15_000 });
    // Каталог на рейс (listAvailableDrivers?tripId=): обычная машина подходит рейсу и свободна в его окне.
    const dlg = await openRequest(page, s);
    await expect(dlg).toContainText(`${s.code} · ${YUG}`);
    await expect(value(dlg, 'Согласует')).toHaveText(`Менеджер фирмы ${YUG}`);
    await expect(dlg.getByRole('radiogroup', { name: 'Машина' })).toBeVisible();
    await expect(radio(dlg, 'Едет на своей обычной')).toHaveAttribute('aria-checked', 'false');
    await expect(radio(dlg, 'Ставим нашу машину')).toHaveAttribute('aria-checked', 'true');
    await expect(dlg).toContainText(`${USUAL} · ${s.usual.plate} · ${YUG}`);
    await expect(dlg).toContainText('Рефрижератор · 1,8 т · 13 м³ · кузов 3,6 м · −10…+10 °C');
    await expect(dlg).toContainText('Подходит рейсу · свободна ');
    await expect(dlg).toContainText(`Машину тоже согласует ${YUG}.`);
    // Возврат 4 (Q-W2.74-16): число свободных машин фирмы рейса на общем стенде зависит от прогонов на других
    // проектах (к третьему свободна одна) — форма по числу: «1 из 1 свободной машины», «2 из 5 свободных машин».
    const hintEl = dlg.getByText(/^Рейсу подходит \d+ из \d+ свободн/).first();
    await expect(hintEl).toBeVisible();
    const hint = await hintEl.textContent();
    const [, fit, free, form] =
      /Рейсу подходит (\d+) из (\d+) (свободной машины|свободных машин) Север Логистик\./.exec(
        hint ?? '',
      ) ?? [];
    expect(form, `подсказка о машинах фирмы рейса: «${hint}»`).toBeTruthy();
    expect(Number(fit)).toBeGreaterThanOrEqual(1);
    expect(Number(fit)).toBeLessThanOrEqual(Number(free));
    expect(form).toBe(
      new Intl.PluralRules('ru').select(Number(free)) === 'one'
        ? 'свободной машины'
        : 'свободных машин',
    );
    const host = await hostModel(dlg);
    await expect(choice(dlg)).toHaveAttribute('aria-checked', 'true');
    await expect(choice(dlg)).toContainText(
      new RegExp(`до .+: ${esc(host)} или свою ${esc(USUAL)}\\.`),
    );
    await expect(summary(dlg).first()).toHaveText(
      new RegExp(`^Две брони до выбора на .+: ${esc(host)} и ${esc(USUAL)}\\.`),
    );
    await dlg.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(toast(page)).toHaveText(`Запрос отправлен фирме ${YUG}`, { timeout: 15_000 });
    await expect(dlg).toBeHidden();
    const x = await transferOf(page, s);
    expect(x, 'запрос Котовой на стенде').toBeTruthy();
    expect(x?.vehicle).toMatchObject({
      mode: 'host_or_home',
      hostVehicle: { displayName: host },
      homeVehicle: { displayName: USUAL },
    });
  });
});
