// Эталон design-stage-1: therapist@t-lotos → страница «cash» через экземпляр компонента прототипа.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WT = process.argv[2];
const EV = process.argv[3];
const require = createRequire(join(WT, 'frontend/apps/web/package.json'));
const { chromium } = require('@playwright/test');
const REF = 'http://127.0.0.1:4118/%D0%9E%D1%80%D1%82%D1%83%D1%81%20CRM.dc.html';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(REF);
await page.waitForSelector('#ox-main');
await page.waitForLoadState('networkidle');
await page.getByRole('combobox', { name: 'Персонаж' }).selectOption('therapist@t-lotos');
await page.waitForTimeout(1000);
const res = await page.evaluate(() => {
  const el = document.getElementById('ox-main');
  const keys = Object.keys(el);
  const k = keys.find((x) => x.startsWith('__reactFiber') || x.startsWith('__reactInternalInstance'));
  if (!k) return 'нет fiber: ' + keys.join(',');
  let f = el[k];
  const seen = [];
  while (f) {
    const sn = f.stateNode;
    if (sn && typeof sn === 'object' && !(sn instanceof Node)) {
      seen.push(Object.getOwnPropertyNames(Object.getPrototypeOf(sn)).slice(0, 8).join('/'));
      if (typeof sn.setPage === 'function') { sn.setPage('cash'); return 'ok'; }
      for (const key of Object.keys(sn)) {
        const v = sn[key];
        if (v && typeof v === 'object' && typeof v.setPage === 'function') { v.setPage('cash'); return 'ok ' + key; }
      }
      seen.push('own:' + Object.keys(sn).join(','));
    }
    f = f.return;
  }
  return 'не найдено: ' + seen.join(' | ');
});
console.log(res);
await page.waitForTimeout(1000);
await page.locator('[aria-label="Панель демонстрации"]').evaluate((e) => (e.style.display = 'none')).catch(() => {});
const main = await page.locator('#ox-main').innerText();
console.log(main.slice(0, 400));
await page.screenshot({ path: join(EV, 'ref-therapist-lotos-cash-1440.png') });
writeFileSync(join(EV, 'ref-therapist-lotos-cash-1440.txt'), `${res}\n${main}`, 'utf8');
await browser.close();
