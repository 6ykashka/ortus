// W7.13 · Сверка `chats` «Чаты» со снимком design-2026-10-19 (verification-protocol.md §3): владелец «Альты»,
// «Сообщения», «Политики» и диалог «Новый чат». Шапку и меню закрывает маска (их сверяет ключ `shell`).
// Расхождения данных и разметки — allowlist/chats.md. Подписи — chats.labels.spec.ts.
import type { Locator, Page } from '@playwright/test';

import { devScenario, tenantId } from '../shell.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { openOnReference } from './modules.compare.ts';
import { compareShots } from './shell.compare.ts';

const CHROME = ['header', 'nav'];
const CASES = ['messages', 'policy', 'dialog'] as const;
/** Допуск: 0,01 (D-22) плюс данные эталона и контракта — записи pixel в allowlist/chats.md. */
const LIMIT = { messages: 0.07, policy: 0.06, dialog: 0.14 } as const;

const main = (page: Page): Locator => page.locator('#ox-main');

async function show(page: Page, c: (typeof CASES)[number]): Promise<void> {
  if (c === 'policy') await main(page).getByRole('button', { name: 'Политики' }).click();
  if (c === 'dialog') {
    await main(page).getByRole('button', { name: 'Новый чат' }).click();
    await page.getByRole('dialog').waitFor();
  }
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

for (const c of CASES) {
  test(`chats: «${c}» владельца в допуске allowlist @mock`, async ({
    app,
    page,
    reference,
    harness,
  }, testInfo) => {
    test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
    const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
    await openOnReference(ref.page, 'Чаты');
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await app(`/t/${alta}/chat`, { persona: 'owner' });
    await expect(page.getByRole('heading', { level: 1, name: 'Чаты' })).toBeVisible();
    await expect(page.locator('.ox-chat-row-btn').first()).toBeVisible();
    await show(ref.page, c);
    await show(page, c);
    const impl = { kind: 'app' as const, page, root: page.locator('#app'), url: page.url() };
    const r = await compareShots(
      { target: impl, mask: CHROME.map((s) => page.locator(s)) },
      {
        target: { kind: 'reference', page: ref.page, root: ref.root, url: ref.page.url() },
        mask: CHROME.map((s) => ref.page.locator(s)),
      },
      `chats-${c}-${testInfo.project.name}`,
      testInfo,
      LIMIT[c],
    );
    console.log(`visual chats ${c} ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`);
    expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
  });
}
