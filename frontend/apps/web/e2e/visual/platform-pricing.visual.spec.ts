// W4.61 · Визуальная и структурная сверка `platform-pricing` со снимком design-2026-10-19 (verification-protocol.md
// §3, PD-22: 0,01): «Тарифная сетка» на высоком окне в просмотре, в черновике v3 и с запланированной версией (390,
// 1440), диалоги публикации и отмены. Автор новой версии — сокращённое имя аккаунта: эталон приводится (allowlist).
import type { Page } from '@playwright/test';

import { applyAllowlist, collectLabels, type Target } from '@ortus/e2e-kit';

import { expect, test } from '../fixtures/index.ts';
import { goReference, mainTarget, tall } from './billing.compare.ts';
import { allowlist, compareShots } from './shell.compare.ts';

const SECTION = 'section[aria-labelledby="h-pb"]';

type Mode = 'view' | 'draft' | 'scheduled';

async function open(
  app: (route: string, o?: { persona?: 'operator' }) => Promise<unknown>,
  page: Page,
  reference: (file?: string, o?: { persona?: 'operator'; hidePanel?: boolean }) => Promise<Target>,
  mode: Mode,
): Promise<{ ref: Target; impl: Target }> {
  const ref = await reference(undefined, { persona: 'operator', hidePanel: true });
  await goReference(ref.page, 'Тарифная сетка', 'Тарифная сетка');
  await tall(ref.page);
  await tall(page);
  const impl = (await app('/platform/plans', { persona: 'operator' })) as Target;
  await expect(page.locator(`${SECTION} tbody tr`)).toHaveCount(5);
  for (const p of [ref.page, page]) {
    if (mode === 'view') continue;
    await p.locator(SECTION).getByRole('button', { name: 'Подготовить версию v3' }).click();
    if (mode === 'draft') continue;
    await p.locator(SECTION).getByLabel('Что изменилось').fill('Тест');
    await p.locator(SECTION).getByRole('button', { name: 'Опубликовать v3' }).click();
    await p.getByRole('dialog').getByRole('button', { name: 'Опубликовать' }).click();
    await expect(p.getByRole('dialog')).toHaveCount(0);
    await expect(p.locator(SECTION).getByRole('status')).toContainText('Запланирована версия v3');
  }
  await page.waitForLoadState('networkidle');
  if (mode === 'scheduled') {
    // Автор опубликованной версии: эталон — «Оператор (демо)», реализация — сокращённое имя аккаунта. Эталон
    // перерисовывается после тоста — замена повторяется, пока текст эталона не станет как у реализации.
    await expect
      .poll(() =>
        ref.page.locator(SECTION).evaluate((s) => {
          for (const span of Array.from(s.querySelectorAll('span'))) {
            if (span.children.length === 0 && span.textContent?.includes('Оператор (демо)')) {
              span.textContent = span.textContent.replace('Оператор (демо)', 'Е. Лаптева');
            }
          }
          return s.textContent?.includes('Оператор (демо)') ?? true;
        }),
      )
      .toBe(false);
    await expect(ref.page.getByText('Готово · запись добавлена в журнал')).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(page.getByText('Готово · запись добавлена в журнал')).toHaveCount(0, {
      timeout: 10_000,
    });
    await ref.page.locator(SECTION).evaluate((s) => {
      for (const span of Array.from(s.querySelectorAll('span'))) {
        if (span.children.length === 0 && span.textContent?.includes('Оператор (демо)')) {
          span.textContent = span.textContent.replace('Оператор (демо)', 'Е. Лаптева');
        }
      }
    });
  }
  return { ref, impl };
}

test.describe('platform-pricing — сверка с эталоном @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пиксельная сверка — режим mock');
  // Две цели (эталон и реализация) и высокое окно: под нагрузкой стенда — дольше 30 с.
  test.describe.configure({ timeout: 90_000 });

  for (const mode of ['view', 'draft', 'scheduled'] as const) {
    test(`«Тарифная сетка» (${mode}) целиком в допуске 0,01 и с теми же подписями`, async ({
      app,
      page,
      reference,
    }, testInfo) => {
      const { ref, impl } = await open(app, page, reference, mode);
      const entries = allowlist('platform-pricing');
      expect(applyAllowlist(await collectLabels(page.locator(SECTION)), entries, 'mock')).toEqual(
        applyAllowlist(await collectLabels(ref.page.locator(SECTION)), entries, 'mock'),
      );
      const key = `platform-pricing-${mode}-${testInfo.project.name}`;
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

  for (const kind of ['publish', 'cancel'] as const) {
    test(`диалог ${kind === 'publish' ? '«Опубликовать тарифную сетку v3?»' : '«Отменить версию v3?»'} в допуске 0,01`, async ({
      app,
      page,
      reference,
    }, testInfo) => {
      const { ref, impl } = await open(
        app,
        page,
        reference,
        kind === 'publish' ? 'draft' : 'scheduled',
      );
      for (const p of [ref.page, page]) {
        const s = p.locator(SECTION);
        if (kind === 'publish') await s.getByRole('button', { name: 'Опубликовать v3' }).click();
        else await s.getByRole('button', { name: 'Отменить версию' }).click();
        await expect(p.getByRole('dialog')).toBeVisible();
      }
      expect(await collectLabels(page.getByRole('dialog'))).toEqual(
        await collectLabels(ref.page.getByRole('dialog')),
      );
      const key = `platform-pricing-dialog-${kind}-${testInfo.project.name}`;
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
