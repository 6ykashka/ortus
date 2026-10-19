// W2.20 · Визуальная сверка `logistics-fleet` «Рабочее место логиста» со снимком design-stage-2
// (verification-protocol.md §3, порог 0,01). Предмет — основная область; шапку и меню сверяет ключ `shell`
// (маска). Персонаж — владелец (бриф §6 п. 5): на эталоне «Логистика» изначально не подключена — владелец
// подключает её в «Модули и место» (шаг 1 «Пути проверки»), затем открывает рабочее место из меню. Логист
// Марина Котова на эталоне без роли (шаг 2 — диалог назначения роли) — её экран сверяют e2e по подписям.
// Кадр — верх страницы (крошка, заголовок, счётчики, вкладки рейсов, «Подбор транспорта»). Кнопка
// «Запланировать рейс» и «Импорт машин» (W2.50) — без эталона (allowlist/logistics-fleet.md, бриф §10 п. 2):
// скрываются до снимка.
// Отличия — allowlist/logistics-fleet.md.
import type { Page } from '@playwright/test';

import { expect, test } from '../fixtures/index.ts';
import { FLEET_H1, openFleet, tabs } from '../logistics.helpers.ts';
import { openOnReference } from './modules.compare.ts';
import { compareShots } from './shell.compare.ts';

const CHROME = ['header', 'nav'];

/** Эталон: владелец подключает «Логистику» в «Модули и место» (диалог «Подключить «Логистика»?»). */
async function connectLogisticsOnReference(page: Page): Promise<void> {
  await openOnReference(page, 'Модули и место', 'Модули');
  await page
    .locator('article')
    .filter({ has: page.getByRole('heading', { level: 3, name: 'Логистика' }) })
    .getByRole('button', { name: 'Подключить' })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Подключить', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
}

/** Рабочее место загружено: вкладки рейсов и строки машин подбора. */
async function fleetReady(page: Page): Promise<void> {
  await page.getByRole('heading', { level: 1, name: FLEET_H1 }).waitFor();
  await tabs(page).getByRole('tab').first().waitFor();
  await page.locator('.ox-fl-vehicle').nth(4).waitFor();
  await page.waitForLoadState('networkidle');
}

test('logistics-fleet: «Рабочее место логиста» владельца, верх страницы, в допуске 0,01 @mock', async ({
  app,
  page,
  reference,
  harness,
}, testInfo) => {
  test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
  test.slow();
  const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
  await connectLogisticsOnReference(ref.page);
  await openOnReference(ref.page, FLEET_H1, 'Логист');
  const alta = await openFleet(app, page, { persona: 'owner' });
  const impl = await app(`/t/${alta}/fleet`, { persona: 'owner' });
  await fleetReady(page);
  // «Запланировать рейс» и «Импорт машин» (W2.50) — без эталона: скрывается их общий блок действий шапки.
  await page.locator('.ox-fl-actions').evaluateAll((els) => {
    for (const el of els) (el as HTMLElement).style.display = 'none';
  });
  const r = await compareShots(
    { target: impl, mask: CHROME.map((s) => page.locator(s)) },
    { target: ref, mask: CHROME.map((s) => ref.page.locator(s)) },
    `logistics-fleet-owner-${testInfo.project.name}`,
    testInfo,
  );
  console.log(
    `visual logistics-fleet owner ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`,
  );
  expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
});
