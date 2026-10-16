// Reference (design-stage-1 on 4119) screenshots of the driver and foreman gates at 390/768/1440, panel hidden.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';

const WT = process.env.WT;
const EV = process.env.EV;
const { chromium } = createRequire(join(WT, 'frontend/apps/web/package.json'))('@playwright/test');
const URL = 'http://127.0.0.1:4119/' + encodeURIComponent('Ортус CRM.dc.html');
const browser = await chromium.launch();
const out = [];
for (const persona of ['driver', 'foreman']) {
  for (const [w, h] of [[390, 844], [768, 1024], [1440, 900]]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h }, locale: 'ru-RU' })).newPage();
    await page.goto(URL);
    await page.locator('#dc-root > .sc-host').waitFor();
    await page.waitForLoadState('networkidle');
    await page.getByRole('status', { name: 'Загрузка' }).waitFor({ state: 'detached' });
    const panel = page.locator('[aria-label="Панель демонстрации"]');
    await panel.getByLabel('Персонаж').selectOption(persona);
    await page.getByRole('status', { name: 'Загрузка' }).waitFor({ state: 'detached' });
    await page.waitForLoadState('networkidle');
    await panel.evaluate((el) => { el.style.display = 'none'; });
    const card = await page.evaluate(() => { const h = document.querySelector('#ox-main h1'); const c = h?.parentElement; return c ? [...c.children].map((e) => e.textContent.trim()) : null; });
    out.push(`${persona} ${w}: ${JSON.stringify(card)}`);
    await page.screenshot({ path: join(EV, `ref-${persona}-${w}.png`) });
    await page.context().close();
  }
}
await browser.close();
writeFileSync(join(EV, 'ref.md'), out.join('\n\n'), 'utf8');
console.log(out.join('\n'));
