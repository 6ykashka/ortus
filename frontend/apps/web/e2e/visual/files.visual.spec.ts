// W1.24 · Сверка `files` «Файлы» со снимком design-stage-1 (verification-protocol.md §3): список файлов в данных
// расходится (эталон — три статических файла и фото рейсов filesVM :4222–4226, MSW — файл осмотра Р-208 примеров
// контракта, PD-43; allowlist/files.md), поэтому пиксели сверяются без списка (заголовок, абзац, «Место
// организации», подпись состояний), а строка списка — по вычисленным стилям первой строки, чипа и кнопки.
import type { Locator, Page } from '@playwright/test';

import { tenantId } from '../shell.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { openOnReference } from './modules.compare.ts';
import { compareShots, labelsOf } from './shell.compare.ts';

const CHROME = ['header', 'nav'];

/** Список эталона — третий блок секции «Файлы» (:1862). */
const refList = (page: Page): Locator =>
  page.locator('section[aria-labelledby="h-files"] > div').nth(2);

async function hide(l: Locator): Promise<void> {
  await l.evaluate((el) => {
    (el as HTMLElement).style.display = 'none';
  });
}

async function openBoth(
  app: (route: string, o?: { persona?: 'owner' }) => Promise<unknown>,
  page: Page,
  reference: (
    file?: string,
    o?: { persona?: 'owner'; hidePanel?: boolean },
  ) => Promise<{ page: Page; root: Locator }>,
) {
  const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
  await openOnReference(ref.page, 'Файлы');
  await app('/', { persona: 'owner' });
  await app(`/t/${await tenantId(page)}/files`, { persona: 'owner' });
  await page.locator('.ox-files-row').first().waitFor();
  await page.locator('.ox-files-usage').waitFor();
  await page.waitForLoadState('networkidle');
  return ref;
}

test('files: «Файлы» без списка в допуске 0,01 @mock', async ({
  app,
  page,
  reference,
  harness,
}, testInfo) => {
  test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
  const ref = await openBoth(app, page, reference);
  await hide(refList(ref.page));
  await hide(page.locator('.ox-files-list'));
  const impl = { kind: 'app' as const, page, root: page.locator('#app'), url: page.url() };
  const r = await compareShots(
    { target: impl, mask: CHROME.map((s) => page.locator(s)) },
    {
      target: { kind: 'reference', page: ref.page, root: ref.root, url: ref.page.url() },
      mask: CHROME.map((s) => ref.page.locator(s)),
    },
    `files-${testInfo.project.name}`,
    testInfo,
  );
  console.log(`visual files ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`);
  expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
});

test('files: стиль строки, чипа «Готов» и кнопки «Открыть» как у эталона @mock', async ({
  app,
  page,
  reference,
  harness,
}) => {
  test.skip(harness.mode !== 'mock', 'сверка стилей — режим mock');
  const ref = await openBoth(app, page, reference);
  const style = (el: Element) => {
    const s = getComputedStyle(el);
    return {
      padding: s.padding,
      gap: s.gap,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      color: s.color,
      background: s.backgroundColor,
      border: s.borderTop,
      radius: s.borderRadius,
      minHeight: s.minHeight,
    };
  };
  // Первые строки: граница сверху прозрачная у обеих (:1863, f.line).
  const refRow = refList(ref.page).locator(':scope > div').first();
  const implRow = page.locator('.ox-files-row').first();
  expect(await implRow.evaluate(style)).toEqual(await refRow.evaluate(style));
  const refReady = refRow.locator('span[style*="999px"]');
  const implReady = implRow.locator('.ox-files-chip');
  expect(await implReady.evaluate(style)).toEqual(await refReady.evaluate(style));
  const refOpen = refList(ref.page).getByRole('button', { name: 'Открыть' }).first();
  const implOpen = implRow.getByRole('button', { name: 'Открыть' });
  expect(await implOpen.evaluate(style)).toEqual(await refOpen.evaluate(style));
});

test('files: подписи совпадают с эталоном @mock', async ({ app, page, reference, harness }) => {
  test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
  const ref = await openBoth(app, page, reference);
  const expected = await labelsOf([ref.page.locator('#ox-main')], 'files');
  const actual = await labelsOf([page.locator('#ox-main')], 'files');
  expect(actual).toEqual(expected);
  expect(actual).toContain('h1:Файлы');
});
