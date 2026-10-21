// W4.62 · Визуальная сверка `company-branding` «Оформление» со снимком design-2026-10-19 (verification-protocol.md
// §3, порог 0,01). Предмет — основная область; шапку и меню закрывает маска (их сверяет ключ `shell`). Кадры:
// верх страницы «Альты», «Сливовый», автокоррекция #FFD400, термины, меню с открытыми иконками, предпросмотр формы
// и письма, низ страницы; «Лотос» — верх. Отличия — allowlist/company-branding.md.
import { expect, test } from '../fixtures/index.ts';
import { FRAMES, frame, openImpl, openRef } from './company-branding.compare.ts';
import { compareShots } from './shell.compare.ts';

const CHROME = ['header', 'nav'];

for (const f of FRAMES) {
  test(`company-branding: «Оформление» владельца, кадр ${f}, в допуске 0,01 @mock`, async ({
    app,
    page,
    reference,
    harness,
  }, testInfo) => {
    test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
    test.slow();
    const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
    await openRef(ref.page);
    const impl = await openImpl(app, page);
    await frame(ref.page, f);
    await frame(page, f);
    const r = await compareShots(
      { target: impl, mask: CHROME.map((s) => page.locator(s)) },
      { target: ref, mask: CHROME.map((s) => ref.page.locator(s)) },
      `company-branding-${f}-${testInfo.project.name}`,
      testInfo,
    );
    console.log(
      `visual company-branding ${f} ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`,
    );
    expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
  });
}

test('company-branding: «Оформление» «Лотоса», верх, в допуске 0,01 @mock', async ({
  app,
  page,
  reference,
  harness,
}, testInfo) => {
  test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
  test.slow();
  const ref = await reference(undefined, { persona: 'owner@t-lotos', hidePanel: true });
  await openRef(ref.page);
  const impl = await openImpl(app, page, 'owner@t-lotos');
  const r = await compareShots(
    { target: impl, mask: CHROME.map((s) => page.locator(s)) },
    { target: ref, mask: CHROME.map((s) => ref.page.locator(s)) },
    `company-branding-lotos-${testInfo.project.name}`,
    testInfo,
  );
  console.log(
    `visual company-branding lotos ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`,
  );
  expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
});
