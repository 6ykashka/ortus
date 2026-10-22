// W4.61 · Визуальная и структурная сверка `platform-users` со снимком design-2026-10-19 (verification-protocol.md
// §3, PD-22: 0,01): «Пользователи платформы» на высоком окне — все аккаунты с карточкой «Анна Морозова» (выбор эталона
// по умолчанию; в реализации — `?account=`), организация «Ремстрой Плюс», «Ортус · Платформа» (390, 1440).
import type { Page } from '@playwright/test';

import { applyAllowlist, collectLabels, type Target } from '@ortus/e2e-kit';

import { expect, test } from '../fixtures/index.ts';
import { platformUser } from '../billing.helpers.ts';
import { goReference, mainTarget, tall } from './billing.compare.ts';
import { allowlist, compareShots } from './shell.compare.ts';

const SECTION = 'section[aria-labelledby="h-acc"]';

type Mode = 'all' | 'org' | 'platform';

const realmButton = (p: Page, name: string) =>
  p.locator(SECTION).getByRole('navigation', { name: 'Организации' }).getByRole('button').filter({
    hasText: name,
  });

async function open(
  app: (route: string, o?: { persona?: 'operator' }) => Promise<unknown>,
  page: Page,
  reference: (file?: string, o?: { persona?: 'operator'; hidePanel?: boolean }) => Promise<Target>,
  mode: Mode,
): Promise<{ ref: Target; impl: Target }> {
  const ref = await reference(undefined, { persona: 'operator', hidePanel: true });
  await goReference(ref.page, 'Пользователи', 'Пользователи платформы');
  await tall(ref.page, 6400);
  await tall(page, 6400);
  await app('/platform/accounts', { persona: 'operator' });
  const anna = await platformUser(page, 'Анна Морозова');
  const impl = (await app(`/platform/accounts?account=${anna.id}`, {
    persona: 'operator',
  })) as Target;
  await expect(page.getByRole('complementary', { name: 'Карточка аккаунта' })).toContainText(
    'Альта Групп',
  );
  if (mode === 'org') {
    for (const p of [ref.page, page]) await realmButton(p, 'Ремстрой Плюс').click();
    await expect(page.locator(`${SECTION} .ox-acc-orghead`)).toContainText('Павел Орлов');
    await expect(page.locator(`${SECTION} .ox-acc-inorg`)).toHaveCount(5);
    // Выбор в организации: эталон — первый участник (Анна вне «Ремстрой Плюс»), реализация — так же.
  }
  if (mode === 'platform') {
    for (const p of [ref.page, page]) await realmButton(p, 'Ортус · Платформа').click();
    await expect(page.locator(`${SECTION} .ox-op-row`)).toHaveCount(6);
  }
  await page.mouse.move(0, 0);
  await ref.page.mouse.move(0, 0);
  await page.waitForLoadState('networkidle');
  return { ref, impl };
}

test.describe('platform-users — сверка с эталоном @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пиксельная сверка — режим mock');
  // Две цели и окно 6400 px: под нагрузкой стенда — дольше 30 с.
  test.describe.configure({ timeout: 120_000 });

  for (const mode of ['all', 'org', 'platform'] as const) {
    test(`«Пользователи платформы» (${mode}) в допуске 0,01 и с теми же подписями`, async ({
      app,
      page,
      reference,
    }, testInfo) => {
      const { ref, impl } = await open(app, page, reference, mode);
      const entries = allowlist('platform-users');
      expect(applyAllowlist(await collectLabels(page.locator(SECTION)), entries, 'mock')).toEqual(
        applyAllowlist(await collectLabels(ref.page.locator(SECTION)), entries, 'mock'),
      );
      const key = `platform-users-${mode}-${testInfo.project.name}`;
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
});
