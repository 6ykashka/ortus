// W2.24 · Сверка очереди отправки водителя со снимком design-stage-2 (verification-protocol.md §3): состояния
// «Сегодня» без связи — расход на устройстве (строка «Локальный черновик», чип «На устройстве», localExp :3463) и
// «Сдача сохранена на устройстве» (dr.sQueued :822–829). Эталон ведётся своими демо-кнопками («Демо: добавить фото»,
// «Демо-фото чека»), связь рвёт context.setOffline (эталон слушает online/offline :2411–2414); реализация — тем же
// путём водителя (фото через выбор файла, проверка файлов — scanFiles). Пиксели — блок «Расходы» и карточка сдачи в
// допуске 0,01 (закреплённая панель действия закрыта маской на обеих сторонах); подписи #ox-main в состоянии сдачи
// на устройстве — с allowlist driver-outbox.
import { hidePanel, type ReferenceTarget, setPersona } from '@ortus/e2e-kit';
import type { Locator, Page } from '@playwright/test';

import {
  actionBar,
  depart,
  fillInspection,
  openDriver,
  RET_CHECKS,
  scanUntil,
} from '../driver.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { toast } from '../modules.helpers.ts';
import {
  expenseOffline,
  expenseRow,
  finishRoute,
  h2,
  net,
  photosOffline,
} from '../outbox.helpers.ts';
import { openOnReference } from './modules.compare.ts';
import { compareShots, labelsOf } from './shell.compare.ts';

// Эталон (dc.html 600 КБ) и путь до сдачи с загрузками — дольше минуты под нагрузкой общего ПК.
test.describe.configure({ timeout: 240_000 });

const DEP = [
  'Кузов и стёкла осмотрены',
  'Шины и световые приборы исправны',
  'Документы и комплект на месте',
];

/** Карточка блока по заголовку h2 (заголовок — в шапке карточки и у эталона, и у реализации). */
const cardOf = (page: Page, title: string): Locator =>
  h2(page, title).locator('xpath=ancestor::div[2]');

/** Карточка «Сдача сохранена на устройстве» (role=status). */
const queuedCard = (page: Page): Locator =>
  page.locator('[role="status"]').filter({ has: h2(page, 'Сдача сохранена на устройстве') });

/** Закреплённая панель действия: у реализации `.ox-dr-act`, у эталона — родитель кнопки панели. */
const refActionBar = (page: Page, label: string): Locator =>
  page.getByRole('button', { name: label, exact: true }).locator('xpath=..');

async function fill(page: Page, odometer: string, checks: readonly string[]): Promise<void> {
  await page.getByLabel(/^Пробег по одометру, км/).fill(odometer);
  await page.getByRole('button', { name: '½', exact: true }).click();
  for (const c of checks) await page.getByLabel(c, { exact: true }).check();
}

/** Эталон: «Логистика» подключена владельцем, водитель Илья Васильев, бронь ГАЗели, демо-фото, выезд. */
async function referenceOnRoute(ref: ReferenceTarget): Promise<Page> {
  await openOnReference(ref.page, 'Модули и место', 'Модули');
  await ref.page
    .locator('article')
    .filter({ has: ref.page.getByRole('heading', { level: 3, name: 'Логистика' }) })
    .getByRole('button', { name: 'Подключить' })
    .click();
  await ref.page.getByRole('dialog').getByRole('button', { name: 'Подключить' }).click();
  await ref.page.getByRole('dialog').waitFor({ state: 'detached' });
  await setPersona(ref, 'driver');
  await hidePanel(ref);
  const p = ref.page;
  await p.getByRole('heading', { level: 1, name: 'Моя смена' }).waitFor();
  await p
    .locator('article')
    .filter({ hasText: 'ГАЗель Next' })
    .getByRole('button', { name: 'Забронировать' })
    .click();
  await h2(p, 'Осмотр перед выездом').waitFor();
  await p.getByRole('button', { name: 'Демо: добавить фото' }).click();
  await expect(p.getByText('Загружено · демо')).toHaveCount(5, { timeout: 20_000 });
  await fill(p, '84500', DEP);
  await p.getByRole('button', { name: 'Выехать на маршрут' }).click();
  await h2(p, 'Маршрут').waitFor();
  return p;
}

test('driver-outbox: подписи и пиксели — расход и сдача на устройстве @mock', async ({
  app,
  page,
  reference,
  harness,
}, testInfo) => {
  test.skip(harness.mode !== 'mock', 'пиксельная и структурная сверка — режим mock');
  const ref = await referenceOnRoute(await reference(undefined, { persona: 'owner' }));

  // 1. Расход без связи: эталон — «Мойка», демо-фото чека, «Сохранить на устройстве».
  await net(ref, false);
  await ref.getByRole('button', { name: 'Добавить расход' }).click();
  await ref.getByRole('button', { name: 'Мойка', exact: true }).click();
  await ref.getByLabel(/^Сумма, ₽/).fill('400');
  await ref.getByRole('button', { name: 'Демо-фото чека' }).click();
  await ref.getByText('На устройстве · ждёт связи').waitFor();
  await ref.getByRole('button', { name: 'Сохранить на устройстве' }).click();
  await ref.getByText('Локальный черновик').waitFor();

  await openDriver(app, page, 'today');
  await depart(page);
  await net(page, false);
  await expenseOffline(page);
  await expect(expenseRow(page, 'Мойка · 400 ₽')).toBeVisible();
  // Тосты лежат поверх нижней части экрана — снимки после них.
  await expect(toast(page)).toBeHidden({ timeout: 10_000 });
  await expect(
    ref.getByText('Расход сохранён на устройстве. Отправится при появлении связи'),
  ).toBeHidden({ timeout: 10_000 });
  await ref.mouse.move(0, 0);
  await page.mouse.move(0, 0);

  const exp = await compareShots(
    {
      target: { kind: 'app', page, root: cardOf(page, 'Расходы'), url: page.url() },
      mask: [actionBar(page)],
    },
    {
      target: { kind: 'reference', page: ref, root: cardOf(ref, 'Расходы'), url: ref.url() },
      mask: [refActionBar(ref, 'Завершить рейс')],
    },
    `driver-outbox-expense-${testInfo.project.name}`,
    testInfo,
  );
  console.log(
    `visual driver-outbox expense ${testInfo.project.name}: ${exp.diffPixels} px, ${exp.ratio}`,
  );
  expect(exp.pass, `расход: ${exp.diffPixels} px, ${exp.ratio}`).toBe(true);

  // 2. Сдача без связи: связь (расход уходит), «Завершить рейс», без связи — фото, осмотр, сохранение.
  await net(ref, true);
  await ref.getByText('Принято сервером', { exact: true }).first().waitFor({ timeout: 15_000 });
  await ref.getByRole('button', { name: 'Завершить рейс' }).click();
  await ref.getByRole('dialog').getByRole('button', { name: 'Завершить рейс' }).click();
  await h2(ref, 'Осмотр при сдаче').waitFor();
  await net(ref, false);
  await ref.getByRole('button', { name: 'Демо: добавить фото' }).click();
  await expect(ref.getByText('На устройстве · ждёт связи')).toHaveCount(5);
  await fill(ref, '84560', RET_CHECKS);
  await ref.getByRole('button', { name: 'Сохранить сдачу на устройстве' }).click();
  await queuedCard(ref).waitFor();
  await expect(ref.getByText('Сдача сохранена на устройстве и ещё не принята сервером')).toBeHidden(
    { timeout: 10_000 },
  );
  await ref.mouse.move(0, 0);

  await net(page, true);
  await scanUntil(page, page.getByText('Мойка 400 ₽ — принято сервером'));
  await finishRoute(page);
  await net(page, false);
  await photosOffline(page);
  await fillInspection(page, '84560', RET_CHECKS);
  await actionBar(page).getByRole('button', { name: 'Сохранить сдачу на устройстве' }).click();
  await expect(queuedCard(page)).toBeVisible();
  await expect(toast(page)).toBeHidden({ timeout: 10_000 });
  await page.mouse.move(0, 0);

  const expected = await labelsOf([ref.locator('#ox-main')], 'driver-outbox');
  const actual = await labelsOf([page.locator('#ox-main')], 'driver-outbox');
  expect(actual).toEqual(expected);

  const card = await compareShots(
    { target: { kind: 'app', page, root: queuedCard(page), url: page.url() } },
    { target: { kind: 'reference', page: ref, root: queuedCard(ref), url: ref.url() } },
    `driver-outbox-return-${testInfo.project.name}`,
    testInfo,
  );
  console.log(
    `visual driver-outbox return ${testInfo.project.name}: ${card.diffPixels} px, ${card.ratio}`,
  );
  expect(card.pass, `сдача: ${card.diffPixels} px, ${card.ratio}`).toBe(true);
  await net(ref, true);
  await net(page, true);
});
