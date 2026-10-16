// W1.20 · Визуальная сверка `shell` со снимком design-stage-1 (verification-protocol.md §3, PD-22: 0,01).
// Содержимое страниц (`#ox-main`) закрыто маской на обеих целях: «Главная» — W2.25, «Организации» — W1.25.
import { expect, test } from '../fixtures/index.ts';
import { compareShots } from './shell.compare.ts';

const CASES = [
  { persona: 'owner', key: 'shell-owner' },
  { persona: 'operator', key: 'shell-operator' },
  { persona: 'driver', key: 'shell-driver' },
  { persona: 'therapist', key: 'shell-therapist' },
  { persona: 'foreman', key: 'shell-foreman' },
] as const;

test.describe('shell — визуальная сверка с эталоном @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пиксельная сверка — режим mock');

  for (const c of CASES) {
    test(`${c.persona}: шапка и меню в допуске 0,01`, async ({
      app,
      page,
      reference,
    }, testInfo) => {
      const ref = await reference(undefined, { persona: c.persona, hidePanel: true });
      const impl = await app('/', { persona: c.persona });
      await expect(page.locator('nav.ox-sidebar .ox-nav-item').first()).toBeAttached();
      await page.waitForLoadState('networkidle');
      const r = await compareShots(
        { target: impl, mask: [page.locator('#ox-main')] },
        { target: ref, mask: [ref.page.locator('#ox-main')] },
        `${c.key}-${testInfo.project.name}`,
        testInfo,
      );
      testInfo.annotations.push({ type: 'ratio', description: String(r.ratio) });
      console.log(`visual ${c.key} ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`);
      expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
    });
  }
});
