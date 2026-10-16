// Computed colors of the warn gate («Нет права») vs reference TONE.warn (#FAF1DC / #7A5214).
import { createRequire } from 'node:module';
import { join } from 'node:path';
const reqWeb = createRequire(join(process.env.WT, 'frontend/apps/web/package.json'));
const { chromium } = reqWeb('@playwright/test');
const APP = 'http://127.0.0.1:6103';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto(`${APP}/?persona=manager`);
await p.waitForURL(/\/t\/[^/]+\//);
const alta = /\/t\/([^/]+)/.exec(p.url())[1];
await p.goto(`${APP}/t/${alta}/forms?persona=manager`);
await p.locator('.ox-gate').waitFor();
console.log(await p.evaluate(() => {
  const g = document.querySelector('.ox-gate');
  const s = (e) => { const c = getComputedStyle(e); return `${c.backgroundColor} / ${c.color}`; };
  return JSON.stringify({ tone: g.dataset.tone, circle: s(g.children[0]), chip: s(g.children[1]), icon: g.children[0].textContent.trim(), chipHasIcon: g.children[1].children.length });
}));
await b.close();
