// W5.32 · Сверка `cash` «Касса» со снимком design-2026-10-19 (verification-protocol.md §3): владелец «Альты», вкладки
// «Кассы», «Входящие», «Смены», «Настройки». Область модуля — шапку и меню закрывает маска (их сверяет ключ `shell`).
// Расхождения данных и разметки — allowlist/cash.md. Подписи — cash.labels.spec.ts.
import type { Locator, Page } from '@playwright/test';

import { devScenario, tenantId } from '../shell.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { openOnReference } from './modules.compare.ts';
import { compareShots } from './shell.compare.ts';

const CHROME = ['header', 'nav'];
const TABS = ['Кассы', 'Входящие', 'Смены', 'Настройки'] as const;
/** Допуск по вкладкам: 0,01 (D-22) плюс данные эталона и контракта — записи pixel в allowlist/cash.md. */
const LIMIT = { Кассы: 0.05, Входящие: 0.04, Смены: 0.07, Настройки: 0.03 } as const;

const root = (page: Page): Locator => page.locator('#ox-main');
const tabOf = (page: Page, name: string): Locator =>
  root(page)
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .first();

async function openBoth(
  app: (route: string, o?: { persona?: 'owner' }) => Promise<unknown>,
  page: Page,
  reference: (
    file?: string,
    o?: { persona?: 'owner'; hidePanel?: boolean },
  ) => Promise<{ page: Page; root: Locator }>,
  tab: (typeof TABS)[number],
) {
  const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
  await openOnReference(ref.page, 'Касса');
  // Вкладка «Подотчёт» выдающего — W5.33 (в реализации её ещё нет): на эталоне снимается (allowlist/cash.md).
  await ref.page.evaluate(() => {
    for (const b of Array.from(document.querySelectorAll('#ox-main button'))) {
      if (
        b.textContent?.trim().startsWith('Подотчёт') &&
        b.closest('div')?.querySelector('h1') === null
      ) {
        if (b.parentElement?.children.length && b.parentElement.children.length >= 4) b.remove();
      }
    }
  });
  await app('/', { persona: 'owner' });
  const alta = await tenantId(page);
  await devScenario(page, { preset: 'logistics-ready' });
  await app(`/t/${alta}/cash`, { persona: 'owner' });
  await expect(page.getByRole('heading', { level: 1, name: 'Касса' })).toBeVisible();
  await expect(page.locator('.ox-ca-op').first()).toBeVisible();
  if (tab !== 'Кассы') {
    await tabOf(ref.page, tab).click();
    await tabOf(page, tab).click();
  }
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await ref.page.evaluate(() => document.fonts.ready.then(() => undefined));
  return ref;
}

for (const tab of TABS) {
  test(`cash: «${tab}» владельца в допуске allowlist @mock`, async ({
    app,
    page,
    reference,
    harness,
  }, testInfo) => {
    test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
    const ref = await openBoth(app, page, reference, tab);
    const impl = { kind: 'app' as const, page, root: page.locator('#app'), url: page.url() };
    const r = await compareShots(
      { target: impl, mask: CHROME.map((s) => page.locator(s)) },
      {
        target: { kind: 'reference', page: ref.page, root: ref.root, url: ref.page.url() },
        mask: CHROME.map((s) => ref.page.locator(s)),
      },
      `cash-${tab}-${testInfo.project.name}`,
      testInfo,
      LIMIT[tab],
    );
    console.log(`visual cash ${tab} ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`);
    expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
  });
}
