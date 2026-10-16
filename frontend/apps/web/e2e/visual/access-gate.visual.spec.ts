// W1.20 · Визуальная сверка `access-gate` со снимком design-stage-1 (verification-protocol.md §3, PD-22: 0,01).
// Предмет — карточка гейта в основной области; шапка и меню сверяются ключом `shell` и закрыты маской. На эталоне
// кнопка «Демо: открыть как владелец» снимается до снимка (PD-54: в реализации её нет). Вариант с действием —
// гейт владельца по прямому URL («Открыть «Модули и место»», :200): на эталоне — карточка прораба с подписями
// владельца (ownerGateCard), стиль кнопки сверяется отдельно (min-height 44, padding 0 18px, gap 6px).
import { gate } from '@ortus/texts';

import { tenantId } from '../shell.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { compareShots, dropDemoButtons, ownerGateCard } from './shell.compare.ts';

const CHROME = ['header', 'nav'];

for (const persona of ['driver', 'foreman'] as const) {
  test(`access-gate: гейт ${persona} в допуске 0,01 @mock`, async ({
    app,
    page,
    reference,
    harness,
  }, testInfo) => {
    test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
    const ref = await reference(undefined, { persona, hidePanel: true });
    await dropDemoButtons(ref.root);
    const impl = await app('/', { persona });
    await expect(page.locator('.ox-gate')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const r = await compareShots(
      { target: impl, mask: CHROME.map((s) => page.locator(s)) },
      { target: ref, mask: CHROME.map((s) => ref.page.locator(s)) },
      `access-gate-${persona}-${testInfo.project.name}`,
      testInfo,
    );
    console.log(
      `visual access-gate ${persona} ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`,
    );
    expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
  });
}

test('access-gate: гейт владельца с действием «Открыть «Модули и место»» в допуске 0,01 @mock', async ({
  app,
  page,
  reference,
  harness,
}, testInfo) => {
  test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
  const ref = await reference(undefined, { persona: 'foreman', hidePanel: true });
  await ownerGateCard(ref.root, gate.a.textOwner, gate.actions.openModules);
  await app('/', { persona: 'owner' });
  const impl = await app(`/t/${await tenantId(page)}/repair`, { persona: 'owner' });
  const action = page.getByRole('button', { name: gate.actions.openModules });
  await expect(action).toBeVisible();
  await page.waitForLoadState('networkidle');

  const style = (b: Element) => {
    const s = getComputedStyle(b);
    return { minHeight: s.minHeight, padding: s.padding, width: b.getBoundingClientRect().width };
  };
  const refButton = ref.page.locator('main button', { hasText: gate.actions.openModules });
  const [want, got] = [await refButton.evaluate(style), await action.evaluate(style)];
  expect({ minHeight: got.minHeight, padding: got.padding }).toEqual({
    minHeight: want.minHeight,
    padding: want.padding,
  });
  expect(Math.abs(got.width - want.width)).toBeLessThanOrEqual(1);

  const r = await compareShots(
    { target: impl, mask: CHROME.map((s) => page.locator(s)) },
    { target: ref, mask: CHROME.map((s) => ref.page.locator(s)) },
    `access-gate-owner-${testInfo.project.name}`,
    testInfo,
  );
  console.log(`visual access-gate owner ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`);
  expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
});
