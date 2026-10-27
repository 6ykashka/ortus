// W7.32 · Сверка `service` «Обращения» со снимком design-2026-10-19 (verification-protocol.md §3): владелец «Альты», состояния
// «Очередь», «Низкие оценки», «Карточка» (МАС-41, жалоба на сотрудника). Область модуля — шапку и меню закрывает маска (их
// сверяет ключ `shell`). Расхождения данных и разметки — allowlist/service.md. Подписи — service.labels.spec.ts.
import type { Locator, Page } from '@playwright/test';

import { tenantId } from '../shell.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { openServiceOnReference, SERVICE_STATES, showServiceState } from './service.compare.ts';
import { compareShots } from './shell.compare.ts';

const CHROME = ['header', 'nav'];
/** Допуск по состояниям: 0,01 (D-22) плюс данные эталона и контракта — записи pixel в allowlist/service.md. */
const LIMIT = { Очередь: 0.01, 'Низкие оценки': 0.015, Карточка: 0.02 } as const;

/** На 390: чипы навигации с зазором 10 px (цели ≥ 44 px), в эталоне 6 px, и пробелы у «·» — записи pixel в allowlist/service.md. */
const LIMIT_PHONE = { Очередь: 0.04, 'Низкие оценки': 0.05, Карточка: 0.085 } as const;

const root = (page: Page): Locator => page.locator('#ox-main');

for (const state of SERVICE_STATES) {
  test(`service: «${state}» владельца в допуске allowlist @mock`, async ({
    app,
    page,
    reference,
    harness,
  }, testInfo) => {
    test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
    test.setTimeout(120_000);
    const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
    await openServiceOnReference(ref.page);
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await app(`/t/${alta}/service`, { persona: 'owner' });
    await expect(page.getByRole('heading', { level: 1, name: 'Обращения' })).toBeVisible();
    await expect(page.locator('.ox-sv-row').nth(1)).toBeVisible();
    await showServiceState(ref.page.locator('#dc-root'), state);
    await showServiceState(root(page), state);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await ref.page.evaluate(() => document.fonts.ready.then(() => undefined));
    const impl = { kind: 'app' as const, page, root: page.locator('#app'), url: page.url() };
    const r = await compareShots(
      { target: impl, mask: CHROME.map((s) => page.locator(s)) },
      {
        target: { kind: 'reference', page: ref.page, root: ref.root, url: ref.page.url() },
        mask: CHROME.map((s) => ref.page.locator(s)),
      },
      `service-${state}-${testInfo.project.name}`,
      testInfo,
      testInfo.project.name.includes('390') ? LIMIT_PHONE[state] : LIMIT[state],
    );
    console.log(`visual service ${state} ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`);
    expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
  });
}
