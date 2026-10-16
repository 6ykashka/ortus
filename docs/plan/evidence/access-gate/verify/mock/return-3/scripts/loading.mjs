// Loading / error frames on the driver gate route, plus Tab through the owner gate at 390.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WT = process.env.WT;
const EV = process.env.EV;
const { chromium } = createRequire(join(WT, 'frontend/apps/web/package.json'))('@playwright/test');
const APP = 'http://127.0.0.1:6103';
const out = [];
const note = (s) => { out.push(s); console.log(s); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
const page = await ctx.newPage();
const scen = (body) => page.evaluate(async (body) => {
  const c = /(?:^|;\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1];
  const r = await fetch('/api/v1/dev/scenario', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), ...(c ? { 'X-CSRF-Token': decodeURIComponent(c) } : {}) }, body: JSON.stringify(body) });
  return r.status;
}, body);
try {
  await page.goto(`${APP}/?persona=driver`);
  await page.locator('.ox-gate').waitFor();
  note('scenario delay once: ' + (await scen({ scenario: 'getMyContext=delay=2500', once: true })));
  await page.reload();
  const st = page.getByRole('status', { name: 'Загрузка' });
  await st.waitFor({ timeout: 2000 });
  note('loading: status «Загрузка» visible=' + (await st.isVisible()) + ' text=' + JSON.stringify(await st.innerText()) + ' gate=' + (await page.locator('.ox-gate').count()));
  await page.screenshot({ path: join(EV, 'driver-loading-frame-1440.png') });
  await page.locator('.ox-gate').waitFor({ timeout: 8000 });
  note('after load: gate h1=' + JSON.stringify(await page.locator('h1').allInnerTexts()) + ' status gone=' + ((await st.count()) === 0));

  note('scenario error: ' + (await scen({ scenario: 'getMyContext=offline' })));
  await page.reload();
  const al = page.getByRole('alert');
  await al.first().waitFor({ timeout: 5000 });
  note('error: ' + JSON.stringify(await al.allInnerTexts()) + ' gate=' + (await page.locator('.ox-gate').count()));
  note('clear: ' + (await scen({ scenario: null, reset: true })));

  // owner gate at 390: Tab reaches the action, focus visible, Enter → modules
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${APP}/?persona=owner`);
  await page.waitForURL(/\/t\/[^/]+\//);
  const alta = /\/t\/([^/]+)/.exec(page.url())[1];
  await page.goto(`${APP}/t/${alta}/repair?persona=owner`);
  await page.locator('.ox-gate button').waitFor();
  const btn = await page.locator('.ox-gate button').boundingBox();
  note('390 owner action box: ' + JSON.stringify(btn));
  let i = 0;
  for (; i < 30; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => !!document.activeElement?.closest('.ox-gate'))) break;
  }
  note('390 Tab steps to action: ' + (i + 1) + ' outline=' + (await page.evaluate(() => { const c = getComputedStyle(document.activeElement); return c.outlineStyle + ' ' + c.outlineWidth + ' ' + c.outlineColor; })));
  await page.keyboard.press('Space');
  await page.waitForURL(/\/modules$/);
  note('390 Space → ' + new URL(page.url()).pathname);
  note('scrollW 390: ' + (await page.evaluate(() => document.scrollingElement.scrollWidth)));
} catch (e) {
  note('ERROR ' + e.stack);
} finally {
  writeFileSync(join(EV, 'loading-error-keyboard.md'), out.join('\n\n'), 'utf8');
  await browser.close();
}
