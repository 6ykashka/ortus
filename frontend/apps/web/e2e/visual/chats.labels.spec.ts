// W7.13 · Структурная сверка `chats` «Чаты» со снимком design-2026-10-19 (verification-protocol.md §3 п. 4): подписи
// страницы («Сообщения»), вкладки «Политики» и диалога «Новый чат» в порядке документа, с учётом allowlist/chats.md.
// Данные эталона, которых нет в контракте 0.12.0 или в сиде mock (названия чатов, тексты сообщений, число
// непрочитанных), и поведение без эталона — записи allowlist.
import type { Locator, Page } from '@playwright/test';

import { devScenario, tenantId } from '../shell.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { openOnReference } from './modules.compare.ts';
import { labelsOf } from './shell.compare.ts';

/** head — шапка страницы («Чаты», «Сообщения», «Политики», «Новый чат»): список и лента — данные сида (allowlist/chats.md). */
const CASES = ['head', 'policy', 'dialog'] as const;

const area = (page: Page, c: (typeof CASES)[number]): Locator =>
  c === 'dialog'
    ? page.getByRole('dialog')
    : c === 'head'
      ? page.locator('#ox-main h1').locator('xpath=../..')
      : page.locator('#ox-main');
const head = (page: Page): Locator => page.locator('#ox-main');

async function show(page: Page, c: (typeof CASES)[number]): Promise<void> {
  if (c === 'policy') await head(page).getByRole('button', { name: 'Политики' }).click();
  if (c === 'dialog') {
    await head(page).getByRole('button', { name: 'Новый чат' }).click();
    await page.getByRole('dialog').waitFor();
  }
  await page.waitForLoadState('networkidle');
}

for (const c of CASES) {
  test(`chats: подписи «${c}» совпадают с эталоном @mock`, async ({
    app,
    page,
    reference,
    harness,
  }) => {
    test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
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
    const expected = await labelsOf([area(ref.page, c)], 'chats');
    const actual = await labelsOf([area(page, c)], 'chats');
    expect(actual).toEqual(expected);
  });
}
