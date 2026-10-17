// W2.22 · Сверка экрана водителя со снимком design-stage-2 (verification-protocol.md §3): состояние «Выберите машину»
// страницы «Сегодня» и страница «Автомобили» — подписи (collectLabels с allowlist driver-today / driver-cars) и
// пиксели в допуске 0,01 (шапка и меню закрыты маской — их сверяет W1.20). Персонаж — «Водитель · Илья Васильев».
import { hidePanel, type ReferenceTarget, setPersona } from '@ortus/e2e-kit';
import type { Page } from '@playwright/test';

import { openDriver } from '../driver.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { openOnReference } from './modules.compare.ts';
import { compareShots, labelsOf } from './shell.compare.ts';

const CHROME = ['header', 'nav'];

// Эталон (dc.html 600 КБ) под нагрузкой общего ПК собирается дольше 30 с.
test.describe.configure({ timeout: 120_000 });

type RefFn = (
  file?: string,
  o?: { persona?: 'owner' | 'driver'; hidePanel?: boolean },
) => Promise<ReferenceTarget>;
type AppFn = (route: string, o?: { persona?: 'driver' }) => Promise<unknown>;

/**
 * Эталон: в начальном состоянии демо «Логистика» не подключена — владелец подключает её в «Модулях и месте»
 * (как пресет logistics-ready реализации), затем персонаж «Водитель · Илья Васильев».
 */
async function openBoth(app: AppFn, page: Page, reference: RefFn, segment: 'today' | 'cars') {
  const ref = await reference(undefined, { persona: 'owner' });
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
  if (segment === 'cars') await openOnReference(ref.page, 'Автомобили');
  else {
    await ref.page.getByRole('heading', { level: 1, name: 'Моя смена' }).waitFor();
    await ref.page.waitForLoadState('networkidle');
  }
  await ref.page.mouse.move(0, 0);
  await openDriver(app, page, segment);
  await page.locator('.ox-dr-car-model').nth(4).waitFor();
  await page.waitForLoadState('networkidle');
  return ref;
}

for (const segment of ['today', 'cars'] as const) {
  const key = segment === 'today' ? 'driver-today' : 'driver-cars';

  test(`${key}: подписи совпадают с эталоном @mock`, async ({ app, page, reference, harness }) => {
    test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
    const ref = await openBoth(app, page, reference, segment);
    const expected = await labelsOf([ref.page.locator('#ox-main')], key);
    const actual = await labelsOf([page.locator('#ox-main')], key);
    expect(actual).toEqual(expected);
  });

  test(`${key}: пиксели в допуске 0,01 @mock`, async ({
    app,
    page,
    reference,
    harness,
  }, testInfo) => {
    test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
    const ref = await openBoth(app, page, reference, segment);
    if (segment === 'cars') {
      // Крошка подразделения «Москва / Север Логистик» — только при org_units.read (allowlist/driver-cars.md).
      await ref.page
        .locator('section[aria-labelledby="h-cars"] > div:first-child > span')
        .first()
        .evaluate((el) => el.remove());
    }
    const r = await compareShots(
      {
        target: { kind: 'app', page, root: page.locator('#app'), url: page.url() },
        mask: CHROME.map((s) => page.locator(s)),
      },
      {
        target: { kind: 'reference', page: ref.page, root: ref.root, url: ref.page.url() },
        mask: CHROME.map((s) => ref.page.locator(s)),
      },
      `${key}-${testInfo.project.name}`,
      testInfo,
    );
    console.log(`visual ${key} ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`);
    expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
  });
}
