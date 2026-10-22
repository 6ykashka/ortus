// W4.61 · Визуальная и структурная сверка `platform-requests` со снимком design-2026-10-19 (verification-protocol.md
// §3, PD-22: 0,01): очередь «На рассмотрении», «Все заявки» и диалоги «Подтвердить заявку SR-12?» и «Отклонить заявку
// SR-12?» на 390 и 1440. Цена заявки — расчёт по её версии сетки (Q-W4.07-2): эталон приводится к цене реализации.
import type { Page } from '@playwright/test';

import { applyAllowlist, collectLabels, type Target } from '@ortus/e2e-kit';

import { expect, test } from '../fixtures/index.ts';
import { goReference, mainTarget, tall } from './billing.compare.ts';
import { allowlist, compareShots } from './shell.compare.ts';

const SECTION = 'section[aria-labelledby="h-req"]';

/** Цены карточек реализации по номеру заявки. */
async function implPrices(page: Page): Promise<Record<string, string>> {
  return page
    .locator(`${SECTION} article`)
    .evaluateAll((arts) =>
      Object.fromEntries(
        arts.map((a) => [
          (a.querySelector('.ox-rq-number')?.textContent ?? '').trim(),
          (a.querySelector('.ox-rq-price span:last-child')?.textContent ?? '').trim(),
        ]),
      ),
    );
}

/** Цены карточек эталона → цены реализации (по номеру заявки в шапке карточки). */
async function normalizePrices(ref: Page, prices: Record<string, string>): Promise<void> {
  await ref.locator(SECTION).evaluate((section, p) => {
    for (const a of Array.from(section.querySelectorAll('article'))) {
      const number = a.querySelector('h2 + span')?.textContent?.trim() ?? '';
      const price = a.querySelector('span[style*="tabular-nums"]');
      if (price && p[number]) price.textContent = p[number];
    }
  }, prices);
}

async function open(
  app: (route: string, o?: { persona?: 'operator' }) => Promise<unknown>,
  page: Page,
  reference: (file?: string, o?: { persona?: 'operator'; hidePanel?: boolean }) => Promise<Target>,
  all = false,
): Promise<{ ref: Target; impl: Target }> {
  const ref = await reference(undefined, { persona: 'operator', hidePanel: true });
  await goReference(ref.page, 'Заявки на тариф', 'Заявки на изменение тарифа');
  await tall(ref.page);
  await tall(page);
  const impl = (await app(`/platform/requests${all ? '?status=all' : ''}`, {
    persona: 'operator',
  })) as Target;
  await expect(page.locator(`${SECTION} article`)).toHaveCount(all ? 2 : 1);
  if (all) {
    await ref.page.locator(SECTION).getByRole('button', { name: 'Все заявки · 2' }).click();
    await expect(ref.page.locator(`${SECTION} article`)).toHaveCount(2);
  }
  await page.waitForLoadState('networkidle');
  await normalizePrices(ref.page, await implPrices(page));
  return { ref, impl };
}

/** Открывает диалог кнопкой карточки SR-12 и ждёт его отрисовки (лист снизу на 390 — без анимации). */
async function openDialog(page: Page, action: 'approve' | 'reject'): Promise<void> {
  const art = page.locator(`${SECTION} article`).filter({ hasText: 'SR-12' });
  if (action === 'reject') {
    await art.locator('textarea').fill('Нет оплаты');
    await art.getByRole('button', { name: 'Отклонить' }).click();
  } else {
    await art.getByRole('button', { name: 'Подтвердить и подключить' }).click();
  }
  await expect(page.getByRole('dialog')).toBeVisible();
}

test.describe('platform-requests — сверка с эталоном @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пиксельная сверка — режим mock');
  // Две цели (эталон и реализация) и высокое окно: под нагрузкой стенда — дольше 30 с.
  test.describe.configure({ timeout: 90_000 });

  for (const all of [false, true]) {
    const name = all ? 'все заявки' : 'на рассмотрении';
    test(`очередь «${name}» целиком в допуске 0,01`, async ({ app, page, reference }, testInfo) => {
      const { ref, impl } = await open(app, page, reference, all);
      const key = `platform-requests-${all ? 'all' : 'pending'}-${testInfo.project.name}`;
      const r = await compareShots(
        { target: mainTarget(impl) },
        { target: mainTarget(ref) },
        key,
        testInfo,
      );
      console.log(`visual ${key}: ${r.diffPixels} px, ${r.ratio}`);
      expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
    });
  }

  test('подписи очереди совпадают с эталоном', async ({ app, page, reference }) => {
    const { ref } = await open(app, page, reference, true);
    const entries = allowlist('platform-requests');
    const expected = applyAllowlist(
      await collectLabels(ref.page.locator(SECTION)),
      entries,
      'mock',
    );
    const actual = applyAllowlist(await collectLabels(page.locator(SECTION)), entries, 'mock');
    expect(actual).toEqual(expected);
  });

  for (const action of ['approve', 'reject'] as const) {
    test(`диалог «${action === 'approve' ? 'Подтвердить' : 'Отклонить'} заявку SR-12?» в допуске 0,01`, async ({
      app,
      page,
      reference,
    }, testInfo) => {
      const { ref, impl } = await open(app, page, reference);
      await openDialog(ref.page, action);
      await openDialog(page, action);
      const total = await page
        .locator(`${SECTION} article .ox-rq-price span:last-child`)
        .first()
        .textContent();
      // Сумма за период в «Последствиях» подтверждения — из расчёта заявки (Q-W4.07-2).
      const periodTotal = /· ([\d\s ]+₽) за период/.exec(total ?? '')?.[1] ?? '';
      await ref.page.getByRole('dialog').evaluate((d, sum) => {
        for (const li of Array.from(d.querySelectorAll('li'))) {
          const span = li.querySelector('span:last-child');
          if (span?.textContent?.includes('за период'))
            span.textContent = span.textContent.replace(
              /, [\d\s ]+₽ за период/,
              `, ${sum} за период`,
            );
        }
      }, periodTotal);
      expect(await collectLabels(page.getByRole('dialog'))).toEqual(
        await collectLabels(ref.page.getByRole('dialog')),
      );
      const key = `platform-requests-dialog-${action}-${testInfo.project.name}`;
      const r = await compareShots(
        { target: { ...impl, root: page.getByRole('dialog') } },
        { target: { ...ref, root: ref.page.getByRole('dialog') } },
        key,
        testInfo,
      );
      console.log(`visual ${key}: ${r.diffPixels} px, ${r.ratio}`);
      expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
    });
  }
});
