// W2.73 · e2e «Ресурсного пула» S2-20 (D-35; эталон design-2026-10-19b · «Временный водитель - варианты.dc.html»):
// 1b — входящий запрос фирмы водителя («Одобрить с машиной», «Только водителя», «Отклонить» с причиной, :187–232);
// 1f — итог запроса у логиста («Машины рейса», «Журнал», :416–464). Обычная машина Водителя #104 — правка состояния
// mock (logistics-pool-s220.helpers.ts); запрос — логист Котова или владелец через API, решение — владелец.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import {
  driverCard,
  incoming,
  incomingCard,
  openPool,
  POOL_H1,
  tripByNumber,
} from './logistics-pool.helpers.ts';
import {
  apiDecideVehicle,
  apiRequestVehicle,
  DRIVER,
  journal,
  patchChosen,
  patchUsual,
  textLines,
  tripCars,
} from './logistics-pool-s220.helpers.ts';
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
import { call } from './shell.helpers.ts';

type AppFn = Parameters<typeof openPool>[0];

/** Владелец «Альты» на «Ресурсном пуле»; у Водителя #104 — имя и обычная машина Hyundai HD-35. */
async function ownerPool(app: AppFn, page: Page): Promise<string> {
  const alta = await openPool(app, page, { persona: 'owner', route: 'home' });
  await patchUsual(page, alta);
  await app(`/t/${alta}/pool`, { persona: 'owner' });
  await driverCard(page, 'Водитель #104').waitFor();
  return alta;
}

const value = (root: Locator, term: string): Locator =>
  root
    .locator('dt', { hasText: new RegExp(`^${term}$`) })
    .locator('xpath=following-sibling::dd[1]');

interface TransferLike {
  status: string;
  decisionComment?: string;
  vehicle?: { homeDecision?: string };
}

const transfers = async (page: Page, tenant: string): Promise<TransferLike[]> =>
  (
    (
      await call(
        page,
        'GET',
        `/api/v1/tenants/${tenant}/fleet/driver-transfer-requests?direction=outgoing&limit=200`,
      )
    ).body as { items: TransferLike[] }
  ).items;

test.describe('logistics-pool — входящий запрос с машиной (1b) @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');
  test.setTimeout(90_000);

  test('с обычной машиной: «Ждёт решения», «Машина», «Ваша машина», три кнопки, сноска', async ({
    app,
    page,
  }) => {
    const alta = await ownerPool(app, page);
    await apiRequestVehicle(page, alta);
    await page.reload();
    const row = incomingCard(page, 'Водитель #104');
    await expect(row.locator('.ox-pl-code')).toHaveText(`${DRIVER} · Водитель #104`);
    await expect(row).toContainText('Север Логистик просит на рейс Р-211');
    await expect(row).toContainText('Ждёт решения');
    await expect(value(row, 'Когда')).toHaveText('01.10, 14:00–18:00 · доступ до 18:00');
    await expect(value(row, 'Машина')).toHaveText(
      'Их Ford Transit или ваша Hyundai HD-35 — на выбор водителя',
    );
    await expect(row).toContainText('Ваша машина');
    await expect(row).toContainText('Свободна 14:00–18:00');
    await expect(row).toContainText(
      'Удерживается на 14:00–18:00, пока водитель выбирает (до 13:30). Не выберет её — сразу вернётся к вам.',
    );
    await expect(row).toContainText('Что откроется Север Логистик');
    await expect(row).toContainText('По машине: модель, номер, габариты, осмотры этого рейса');
    await expect(row).toContainText('Начисления, история рейсов, другие машины Юг Транс');
    await expect(row.getByRole('button')).toHaveText([
      'Одобрить с машиной',
      'Только водителя',
      'Отклонить',
    ]);
    await expect(row).toContainText(
      'Отклонить можно только с причиной. Начисления по рейсу ведутся отдельной записью, Юг Транс их не получает автоматически.',
    );
    if ((page.viewportSize()?.width ?? 0) < 640) {
      for (const name of ['Одобрить с машиной', 'Только водителя', 'Отклонить']) {
        expect(await hitHeight(row.getByRole('button', { name }))).toBeGreaterThanOrEqual(44);
      }
      expect(await noHorizontalScroll(page)).toBe(true);
    }
  });

  test('«Отклонить» без причины — сообщение, запрос не уходит; с причиной — отклонён', async ({
    app,
    page,
  }) => {
    const alta = await ownerPool(app, page);
    await apiRequestVehicle(page, alta);
    await page.reload();
    const row = incomingCard(page, 'Водитель #104');
    await row.getByRole('button', { name: 'Отклонить' }).click();
    await expect(row.getByRole('alert')).toContainText('Укажите причину отказа');
    expect((await transfers(page, alta))[0]?.status).toBe('requested');
    await row.getByLabel('Причина отказа').fill('Машина нужна на своём рейсе');
    await expect(row.getByRole('alert')).toHaveCount(0);
    await row.getByRole('button', { name: 'Отклонить' }).click();
    await expect(toast(page)).toHaveText('Фирма Юг Транс отклонила запрос');
    await expect(incoming(page)).toBeHidden();
    expect((await transfers(page, alta))[0]).toMatchObject({
      status: 'rejected',
      decisionComment: 'Машина нужна на своём рейсе',
    });
  });

  test('без обычной машины: «Одобрить» / «Отклонить», «Их Ford Transit · М 608 КТ 77»', async ({
    app,
    page,
  }) => {
    const alta = await ownerPool(app, page);
    await apiRequestVehicle(page, alta, 'host');
    await page.reload();
    const row = incomingCard(page, 'Водитель #104');
    await expect(value(row, 'Машина')).toHaveText('Их Ford Transit · М 608 КТ 77');
    await expect(row).not.toContainText('Ваша машина');
    await expect(row.getByRole('button')).toHaveText(['Одобрить', 'Отклонить']);
    await row.getByRole('button', { name: 'Одобрить' }).click();
    await expect(toast(page)).toHaveText('Фирма Юг Транс одобрила запрос');
  });
});

test.describe('logistics-pool — итог запроса у логиста (1f) @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');
  test.setTimeout(90_000);

  /** Логист Котова запрашивает #104 в диалоге с режимом по умолчанию, владелец решает через API. */
  async function logistAsks(
    app: AppFn,
    page: Page,
    decision: 'approve' | 'approve_driver_only',
    pickHome = false,
  ): Promise<{ alta: string; card: Locator }> {
    const alta = await openPool(app, page);
    await patchUsual(page, alta);
    await app(`/t/${alta}/pool`, { persona: 'manager' });
    await driverCard(page, 'Водитель #104')
      .getByRole('button', { name: 'Запросить на рейс Р-211' })
      .click();
    const dlg = page.getByRole('dialog');
    if (pickHome) await dlg.getByRole('radio', { name: 'Едет на своей обычной' }).click();
    await dlg.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(toast(page)).toHaveText('Запрос отправлен фирме Юг Транс');
    await app(`/t/${alta}/pool`, { persona: 'owner' });
    const list = (
      await call(
        page,
        'GET',
        `/api/v1/tenants/${alta}/fleet/driver-transfer-requests?status=requested&limit=200`,
      )
    ).body as { items: { id: string }[] };
    await apiDecideVehicle(page, alta, list.items[0]?.id ?? '', decision);
    await app(`/t/${alta}/pool`, { persona: 'manager' });
    const card = driverCard(page, 'Водитель #104');
    await expect(card.locator('.ox-pl-chip').first()).toContainText('Временно назначен');
    return { alta, card };
  }

  test('«Одобрить с машиной»: брони до выбора, журнал, сноска; «Оставить Ford Transit»', async ({
    app,
    page,
  }) => {
    const { card } = await logistAsks(app, page, 'approve');
    await expect(value(card, 'Рейс')).toHaveText('Р-211 · Охлаждённая продукция · 14:00–18:00');
    await expect(value(card, 'Доступ')).toHaveText('До 18:00, только этот рейс');
    await expect(card.getByText('Машины рейса')).toBeVisible();
    await expect(tripCars(card)).toHaveCount(2);
    await expect(tripCars(card).first()).toContainText('Hyundai HD-35 · Н 384 ТК 77');
    await expect(tripCars(card).first()).toContainText('Юг Транс · обычная машина водителя');
    await expect(tripCars(card).nth(1)).toContainText('Ford Transit · М 608 КТ 77');
    await expect(tripCars(card).nth(1)).toContainText('Север Логистик · наша');
    await expect(tripCars(card).locator('.ox-pl-chip')).toHaveText([
      /Бронь до выбора$/,
      /Бронь до выбора$/,
    ]);
    expect(await journal(card)).toEqual([
      '10:30 Вы запросили водителя. Машина: наша Ford Transit, можно свою обычную.',
      '10:30 Юг Транс одобрил водителя с машиной.',
      '10:30 Брони до выбора на 14:00–18:00: Ford Transit и Hyundai HD-35.',
    ]);
    await expect(card).toContainText(
      'Если водитель не выбирает до 13:30, остаётся Ford Transit, а Hyundai HD-35 возвращается в Юг Транс.',
    );
    // Возврат 3 (ревью r3, minor): на 390 «{модель} · {номер}» строки «Машины рейса» — одной строкой.
    for (const n of await tripCars(card).locator('.ox-pl-trip-car-name').all()) {
      expect(await textLines(n)).toBe(1);
    }
    if ((page.viewportSize()?.width ?? 0) < 640) expect(await noHorizontalScroll(page)).toBe(true);
    await card.getByRole('button', { name: 'Оставить Ford Transit' }).click();
    await expect(tripCars(card).locator('.ox-pl-chip')).toHaveText([
      /Освобождена · 10:30$/,
      /Выбрана · 10:30$/,
    ]);
    await expect(card.getByRole('button', { name: 'Оставить Ford Transit' })).toHaveCount(0);
    expect((await journal(card)).at(-1)).toBe(
      '10:30 Вы оставили Ford Transit. Hyundai HD-35 освобождена.',
    );
  });

  test('водитель выбрал обычную: «Выбрана», «Освобождена», строка журнала', async ({
    app,
    page,
  }) => {
    const { alta, card } = await logistAsks(app, page, 'approve');
    // Выбор водителя (1c–1d) — экран W2.74; здесь — итог выбора в состоянии сервера сценариев (как chooseReservation:
    // бронь обычной confirmed, бронь машины фирмы рейса released с причиной chosen).
    await patchChosen(page, alta, '2026-10-01T10:12:00Z');
    await app(`/t/${alta}/pool`, { persona: 'manager' });
    await expect(tripCars(card).locator('.ox-pl-chip')).toHaveText([
      /Выбрана · 13:12$/,
      /Освобождена · 13:12$/,
    ]);
    expect((await journal(card)).at(-1)).toBe(
      '13:12 Водитель выбрал Hyundai HD-35. Ford Transit освобождена.',
    );
    await expect(card.getByRole('button', { name: 'Оставить Ford Transit' })).toHaveCount(0);
  });
  test('«Только водителя»: «Машины нет…» и «Поставить машину» → «Рабочее место логиста»', async ({
    app,
    page,
  }) => {
    const { alta, card } = await logistAsks(app, page, 'approve_driver_only', true);
    await expect(card).toContainText('Машины нет: Юг Транс выдал водителя без обычной машины.');
    expect(await journal(card)).toEqual([
      '10:30 Вы запросили водителя. Машина: обычная машина водителя.',
      '10:30 Юг Транс одобрил только водителя, без машины.',
      '10:30 Машины нет, рейс попал в «Требует решения».',
    ]);
    const trip = await tripByNumber(page, alta);
    await card.getByRole('button', { name: 'Поставить машину' }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${alta}/fleet\\?trip=${trip.id}$`));
  });

  test('одна машина («Только водителя» при «Наша + можно свою»): «Назначена на Р-211»', async ({
    app,
    page,
  }) => {
    const { card } = await logistAsks(app, page, 'approve_driver_only');
    await expect(tripCars(card)).toHaveCount(1);
    await expect(tripCars(card)).toContainText('Ford Transit · М 608 КТ 77');
    await expect(tripCars(card).locator('.ox-pl-chip')).toHaveText(/Назначена на Р-211$/);
    expect(await journal(card)).toEqual([
      '10:30 Вы запросили водителя. Машина: наша Ford Transit, можно свою обычную.',
      '10:30 Юг Транс одобрил только водителя, без машины.',
      '10:30 Бронь Ford Transit на 14:00–18:00.',
    ]);
  });
});

// Стенд (контракт 0.6.3-stage2): публикация водителя «Юг Транс» с обычной машиной, рейс «Север Логистик» логиста
// Котовой (logistics-pool-s220.stand.ts). Котова запрашивает в диалоге (по умолчанию «Наша + можно свою»), владелец
// решает во «Входящих запросах», итог — в карточке перевода у Котовой. Время журнала и окна — часы стенда.
test.describe('logistics-pool — машина на стенде @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  test.setTimeout(240_000);

  test('владелец: «Одобрить с машиной» → «Машины рейса» и «Журнал» логиста; «Оставить …» — выбрана, освобождена', async ({
    app,
    page,
    session,
    undo,
  }, testInfo) => {
    await realClock(page);
    const s = await s220Stand(session, undo, testInfo.project.name);
    const pool = `/t/${s.tenant}/pool?trip=${s.trip.id}`;
    await app(pool, { persona: 'manager' });
    await expect(h1(page, POOL_H1)).toBeVisible({ timeout: 15_000 });
    const dlg = await openRequest(page, s);
    await expect(dlg.getByRole('radio', { name: 'Ставим нашу машину' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const host = await hostModel(dlg);
    await dlg.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(toast(page)).toHaveText(`Запрос отправлен фирме ${YUG}`, { timeout: 15_000 });

    // Владелец решает за «Юг Транс» (1b): «Машина» — на выбор водителя, «Ваша машина», три кнопки.
    await app(`/t/${s.tenant}/pool`, { persona: 'owner' });
    const row = incomingCard(page, s.code);
    await expect(row).toContainText(`Север Логистик просит на рейс ${s.trip.number}`, {
      timeout: 15_000,
    });
    await expect(row).toContainText('Ждёт решения');
    await expect(value(row, 'Машина')).toHaveText(
      `Их ${host} или ваша ${USUAL} — на выбор водителя`,
    );
    await expect(row).toContainText('Ваша машина');
    await expect(row).toContainText(`${USUAL} · ${s.usual.plate}`);
    await expect(row.getByRole('button')).toHaveText([
      'Одобрить с машиной',
      'Только водителя',
      'Отклонить',
    ]);
    await row.getByRole('button', { name: 'Одобрить с машиной' }).click();
    await expect(toast(page)).toHaveText(`Фирма ${YUG} одобрила запрос`, { timeout: 15_000 });

    // Итог у логиста (1f): две брони до выбора, журнал, сноска о сроке.
    await app(pool, { persona: 'manager' });
    const card = driverCard(page, s.code);
    await expect(card.locator('.ox-pl-chip').first()).toContainText('Временно назначен', {
      timeout: 15_000,
    });
    await expect(card.getByText('Машины рейса')).toBeVisible();
    await expect(tripCars(card)).toHaveCount(2);
    await expect(tripCars(card).first()).toContainText(`${USUAL} · ${s.usual.plate}`);
    await expect(tripCars(card).first()).toContainText(`${YUG} · обычная машина водителя`);
    await expect(tripCars(card).nth(1)).toContainText(host);
    await expect(tripCars(card).nth(1)).toContainText('Север Логистик · наша');
    await expect(tripCars(card).locator('.ox-pl-chip')).toHaveText([
      /Бронь до выбора$/,
      /Бронь до выбора$/,
    ]);
    const lines = await journal(card);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(
      new RegExp(
        `^\\d\\d:\\d\\d Вы запросили водителя\\. Машина: наша ${esc(host)}, можно свою обычную\\.$`,
      ),
    );
    expect(lines[1]).toMatch(/^\d\d:\d\d Юг Транс одобрил водителя с машиной\.$/);
    expect(lines[2]).toMatch(
      new RegExp(`^\\d\\d:\\d\\d Брони до выбора на .+: ${esc(host)} и ${esc(USUAL)}\\.$`),
    );
    await expect(card).toContainText(
      new RegExp(
        `Если водитель не выбирает до .+, остаётся ${esc(host)}, а ${esc(USUAL)} возвращается в Юг Транс\\.`,
      ),
    );

    // «Оставить …» логиста (chooseReservation): своя машина выбрана, обычная освобождена сразу.
    await card.getByRole('button', { name: `Оставить ${host}` }).click();
    await expect(tripCars(card).locator('.ox-pl-chip')).toHaveText(
      [/Освобождена · \d\d:\d\d$/, /Выбрана · \d\d:\d\d$/],
      { timeout: 15_000 },
    );
    await expect(card.getByRole('button', { name: `Оставить ${host}` })).toHaveCount(0);
    expect((await journal(card)).at(-1)).toMatch(
      new RegExp(`^\\d\\d:\\d\\d Вы оставили ${esc(host)}\\. ${esc(USUAL)} освобождена\\.$`),
    );
    expect((await transferOf(page, s))?.vehicle).toMatchObject({
      mode: 'host_or_home',
      hostVehicle: { displayName: host },
      homeVehicle: { displayName: USUAL },
    });
  });

  test('владелец: «Только водителя» на «Своя машина водителя» → «Машины нет…», «Поставить машину»', async ({
    app,
    page,
    session,
    undo,
  }, testInfo) => {
    await realClock(page);
    const s = await s220Stand(session, undo, testInfo.project.name);
    const pool = `/t/${s.tenant}/pool?trip=${s.trip.id}`;
    await app(pool, { persona: 'manager' });
    await expect(h1(page, POOL_H1)).toBeVisible({ timeout: 15_000 });
    const dlg = await openRequest(page, s);
    await dlg.getByRole('radio', { name: 'Едет на своей обычной' }).click();
    await dlg.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(toast(page)).toHaveText(`Запрос отправлен фирме ${YUG}`, { timeout: 15_000 });

    await app(`/t/${s.tenant}/pool`, { persona: 'owner' });
    const row = incomingCard(page, s.code);
    await expect(value(row, 'Машина')).toHaveText(`Ваша ${USUAL} · ${s.usual.plate}`, {
      timeout: 15_000,
    });
    await row.getByRole('button', { name: 'Только водителя' }).click();
    await expect(toast(page)).toHaveText(`Фирма ${YUG} одобрила запрос`, { timeout: 15_000 });

    await app(pool, { persona: 'manager' });
    const card = driverCard(page, s.code);
    await expect(card).toContainText('Машины нет: Юг Транс выдал водителя без обычной машины.', {
      timeout: 15_000,
    });
    await expect(tripCars(card)).toHaveCount(0);
    const lines = await journal(card);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(
      /^\d\d:\d\d Вы запросили водителя\. Машина: обычная машина водителя\.$/,
    );
    expect(lines[1]).toMatch(/^\d\d:\d\d Юг Транс одобрил только водителя, без машины\.$/);
    expect(lines[2]).toMatch(/^\d\d:\d\d Машины нет, рейс попал в «Требует решения»\.$/);
    await card.getByRole('button', { name: 'Поставить машину' }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${s.tenant}/fleet\\?trip=${s.trip.id}$`));
  });
});
