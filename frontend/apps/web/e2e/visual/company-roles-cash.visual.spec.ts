// W5.33 · Визуальная сверка блока «Касса · остаток и лимиты» редактора роли (`company-roles`, Ортус CRM.dc.html
// :373–379) со снимком design-2026-10-19 (verification-protocol.md §3, PD-22: 0,01). Эталон: «Менеджер логистики»
// с включённым модулем «Касса»; реализация: у той же роли включается модуль «Касса» (у роли API ключей cash.* нет).
// Маски: поля лимитов (в реализации недоступны — Q-W5.33-2) и пояснение о несохранении сумм (allowlist
// company-roles.md, запись pixel «hide:ox-role-cash-note»).
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../fixtures/index.ts';
import { implUsers, referenceUsers } from './people.compare.ts';
import { allowlist, compareShots } from './shell.compare.ts';

const HIDE = 'hide:ox-role-cash-note';

const refBlock = (p: Page): Locator =>
  p.locator('strong', { hasText: 'Касса · остаток и лимиты' }).locator('xpath=ancestor::div[2]');

test.describe('company-roles — блок «Касса · остаток и лимиты» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пиксельная сверка — режим mock');

  test('блок кассы в допуске 0,01 (поля лимитов и пояснение — по allowlist)', async ({
    app,
    page,
    reference,
  }, testInfo) => {
    // На 390 цели нажатия блока не ниже 44 px (verification-protocol §1.3; в эталоне 36–40 px): запись state «size:цели
    // нажатия редактора на 390» в allowlist/company-roles.md, пиксельная сверка — на 1440.
    test.skip((page.viewportSize()?.width ?? 0) < 1024, 'сверка блока — на 1440');
    expect(
      allowlist('company-roles').some((e) => e.kind === 'pixel' && e.target === HIDE),
      `нет записи pixel «${HIDE}» в allowlist/company-roles.md`,
    ).toBe(true);
    const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
    await referenceUsers(ref.page, 'Роли');
    await implUsers(app, page, 'tab=roles');
    await page.getByRole('switch', { name: 'Доступ роли к модулю Касса' }).click();
    const block = page.locator('.ox-role-cash');
    await expect(block).toBeVisible();
    // В эталоне у роли «Видеть остаток…» отмечен, «Только свой подотчёт» — нет.
    await block.getByRole('checkbox', { name: /^Видеть остаток/ }).check();
    await page.addStyleTag({ content: '.ox-role-cash-note[data-muted]{display:none!important}' });
    for (const p of [ref.page, page]) {
      await p.mouse.move(0, 0);
      await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    }
    // Верх цели — на целый пиксель с обеих сторон (запись pixel "top:цели сверки состояний редактора").
    for (const l of [block, refBlock(ref.page)]) {
      await l.evaluate(async (el) => {
        await document.fonts.ready;
        el.scrollIntoView({ block: 'center' });
        const frac = el.getBoundingClientRect().top % 1;
        if (frac > 0.001) {
          const m = parseFloat(getComputedStyle(el).marginTop) || 0;
          (el as HTMLElement).style.marginTop = `${m + 1 - frac}px`;
        }
      });
    }
    const shot = (p: Page, root: Locator) => ({
      kind: 'app' as const,
      page: p,
      root,
      url: p.url(),
    });
    const r = await compareShots(
      { target: shot(page, block), mask: [block.locator('input[type="text"], input:not([type])')] },
      {
        target: shot(ref.page, refBlock(ref.page)),
        mask: [refBlock(ref.page).locator('input[inputmode="numeric"]')],
      },
      `company-roles-cash-${testInfo.project.name}`,
      testInfo,
    );
    console.log(
      `visual company-roles-cash ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`,
    );
    expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
  });
});
