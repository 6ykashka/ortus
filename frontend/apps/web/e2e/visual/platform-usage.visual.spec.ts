// W4.61 · Визуальная и структурная сверка `platform-usage` со снимком design-2026-10-19 (verification-protocol.md §3,
// PD-22: 0,01): страница «Использование» целиком на высоком окне (390, 1440). Эталон приведён к данным сценарного
// сервера там, где сид MSW расходится с демо-данными (входы за 7 дней — allowlist/platform-usage.md).
import type { Page } from '@playwright/test';

import { applyAllowlist, collectLabels } from '@ortus/e2e-kit';

import { expect, test } from '../fixtures/index.ts';
import { goReference, mainTarget, tall, textsOf } from './billing.compare.ts';
import { allowlist, compareShots } from './shell.compare.ts';

const SECTION = 'section[aria-labelledby="h-usage"]';

/** Входы за 7 дней из реализации → в эталон (плитка и колонка таблицы по названию организации). */
async function normalizeReference(ref: Page, impl: Page): Promise<void> {
  const implSection = impl.locator(SECTION);
  const tiles = await textsOf(implSection, '.ox-us-tile-value');
  const names = await textsOf(implSection, 'tbody .ox-us-org-name');
  const acts = await textsOf(implSection, 'tbody .ox-us-act');
  const byName = Object.fromEntries(names.map((n, i) => [n, acts[i] ?? '']));
  await ref.locator(SECTION).evaluate(
    (section, v) => {
      const tile = section.querySelectorAll('div[style*="grid-template-columns"] > div')[3];
      const value = tile?.children[1];
      if (value) value.textContent = v.active;
      for (const tr of Array.from(section.querySelectorAll('tbody tr'))) {
        const name = tr.querySelector('td button span')?.textContent?.trim() ?? '';
        const act = tr.querySelectorAll('td')[5]?.querySelector('span');
        const next = v.byName[name];
        if (act && next) act.textContent = next;
      }
    },
    { active: tiles[3] ?? '', byName },
  );
}

async function openBoth(
  app: (route: string, o?: { persona?: 'operator' }) => Promise<unknown>,
  page: Page,
  reference: (
    file?: string,
    o?: { persona?: 'operator'; hidePanel?: boolean },
  ) => Promise<{ page: Page }>,
) {
  const ref = await reference(undefined, { persona: 'operator', hidePanel: true });
  await goReference(ref.page, 'Использование', 'Использование');
  await tall(ref.page);
  await tall(page);
  const impl = await app('/platform/usage', { persona: 'operator' });
  await expect(page.locator(`${SECTION} .ox-us-tile`)).toHaveCount(4);
  await expect(page.locator(`${SECTION} .ox-us-signal`)).toHaveCount(7);
  await expect(page.locator(`${SECTION} .ox-us-signal-text`).nth(3)).toContainText('20.09.2026');
  await page.waitForLoadState('networkidle');
  await normalizeReference(ref.page, page);
  return { ref, impl };
}

test.describe('platform-usage — сверка с эталоном @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пиксельная сверка — режим mock');
  // Две цели (эталон и реализация) и высокое окно: под нагрузкой стенда — дольше 30 с.
  test.describe.configure({ timeout: 90_000 });

  test('«Использование» целиком в допуске 0,01', async ({ app, page, reference }, testInfo) => {
    const { ref, impl } = await openBoth(app, page, reference);
    const r = await compareShots(
      { target: mainTarget(impl as never) },
      { target: mainTarget(ref as never) },
      `platform-usage-${testInfo.project.name}`,
      testInfo,
    );
    console.log(`visual platform-usage ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`);
    expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
  });

  test('подписи кнопок, заголовков и aria совпадают с эталоном', async ({
    app,
    page,
    reference,
  }) => {
    const { ref } = await openBoth(app, page, reference);
    const entries = allowlist('platform-usage');
    const expected = applyAllowlist(
      await collectLabels(ref.page.locator(SECTION)),
      entries,
      'mock',
    );
    const actual = applyAllowlist(await collectLabels(page.locator(SECTION)), entries, 'mock');
    expect(actual).toEqual(expected);
  });
});
