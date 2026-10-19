// W2.31 · Путь водителя при масштабе 200 % (S2-19, 08-requirements «масштаб 200 %», WCAG 2.2 AA 1.4.4, 1.4.10,
// 2.4.11): масштаб браузера — CSS-ширина вдвое меньше при плотности 2 (окно 1280×800 → 640×400). Без горизонтальной
// прокрутки, команды видимы, не закрыты панелью действия и нажимаются; axe без serious/critical.
import type { Locator, Page } from '@playwright/test';

import {
  actionBar,
  carCard,
  DEP_CHECKS,
  fillInspection,
  openDriver,
  reserve,
} from '../driver.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { noHorizontalScroll } from '../modules.helpers.ts';
import { h2, photosOnline } from '../outbox.helpers.ts';

import { deviceOf } from './devices.helpers.ts';

/** Цель в центре после прокрутки к ней — сама цель (не закрыта панелью действия, шапкой или тостом). */
async function reachable(target: Locator): Promise<boolean> {
  return target.evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit !== null && (hit === el || el.contains(hit) || hit.contains(el));
  });
}

/**
 * Закреплённая панель действия (телефон) видима целиком и занимает не больше половины высоты окна; панель в потоке
 * страницы (от 640 px) окно не закрывает — её команды проверяет 
eachable.
 */
async function barFits(page: Page): Promise<boolean> {
  const bar = actionBar(page);
  const pinned = await bar.evaluate((el) => /^(fixed|sticky)$/.test(getComputedStyle(el).position));
  if (!pinned) return true;
  const box = await bar.boundingBox();
  const vp = page.viewportSize();
  if (!box || !vp) return false;
  return box.y >= 0 && box.y + box.height <= vp.height + 1 && box.height <= vp.height / 2;
}

test.describe('масштаб 200 % @devices @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты и сценарии — сценарный сервер mock');
  test.describe.configure({ timeout: 120_000 });

  test('«Сегодня» при 200 %: бронь и осмотр без горизонтальной прокрутки, axe без serious/critical', async ({
    app,
    page,
    axe,
  }, info) => {
    expect(deviceOf(info).zoom).toBe(2);
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);
    const serious = async () =>
      (await axe(page)).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    await openDriver(app, page, 'today');
    await expect(carCard(page, 'ГАЗель Next')).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(await serious()).toEqual([]);
    expect(
      await reachable(carCard(page, 'ГАЗель Next').getByRole('button', { name: 'Забронировать' })),
    ).toBe(true);
    await reserve(page);
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(await serious()).toEqual([]);
    for (const target of [
      page.getByRole('button', { name: /^Спереди: / }),
      page.getByRole('button', { name: /^Одометр: / }),
      page.getByLabel(/^Пробег по одометру, км/),
      page.getByRole('button', { name: 'Полный', exact: true }),
      page.getByLabel(DEP_CHECKS[2], { exact: true }),
      page.getByRole('button', { name: 'Добавить дефект' }),
    ]) {
      expect(await reachable(target), await target.evaluate((e) => e.outerHTML.slice(0, 80))).toBe(
        true,
      );
    }
    expect(await barFits(page)).toBe(true);
  });

  test('при 200 % путь до выезда: панель действия видима, «Выехать на маршрут» нажимается', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await reserve(page);
    await photosOnline(page);
    await fillInspection(page, '84500', DEP_CHECKS);
    const go = actionBar(page).getByRole('button', { name: 'Выехать на маршрут' });
    expect(await reachable(go)).toBe(true);
    expect(await barFits(page)).toBe(true);
    await go.click();
    await expect(h2(page, 'Маршрут')).toBeVisible({ timeout: 15_000 });
    expect(await noHorizontalScroll(page)).toBe(true);
    const arrived = page.getByRole('button', { name: 'Прибыл' }).first();
    expect(await reachable(arrived)).toBe(true);
    expect(await reachable(actionBar(page).getByRole('button', { name: 'Завершить рейс' }))).toBe(
      true,
    );
  });
});
