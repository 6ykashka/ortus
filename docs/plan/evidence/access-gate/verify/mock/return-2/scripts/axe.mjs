// axe on access-gate variants at 390/768/1440 (all impacts recorded; serious/critical counted).
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WT = process.env.WT;
const EV = process.env.EV;
const reqKit = createRequire(join(WT, 'frontend/packages/e2e-kit/package.json'));
const reqWeb = createRequire(join(WT, 'frontend/apps/web/package.json'));
const AxeBuilder = reqKit('@axe-core/playwright').default;
const { chromium } = reqWeb('@playwright/test');
const APP = 'http://127.0.0.1:6103';

const browser = await chromium.launch();
const results = [];
async function api(page, method, path, body) {
  return page.evaluate(async ({ method, path, body }) => {
    const h = {};
    if (method !== 'GET') {
      const c = /(?:^|;\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1];
      if (c) h['X-CSRF-Token'] = decodeURIComponent(c);
      h['Idempotency-Key'] = crypto.randomUUID();
    }
    if (method === 'PUT') { const g = await fetch(path, { credentials: 'include' }); const e = g.headers.get('etag'); if (e) h['If-Match'] = e; }
    if (body) h['Content-Type'] = 'application/json';
    const r = await fetch(path, { method, credentials: 'include', headers: h, body: body ? JSON.stringify(body) : undefined });
    return r.status;
  }, { method, path, body });
}
for (const [w, hgt] of [[390, 844], [768, 1024], [1440, 900]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, locale: 'ru-RU' });
  const page = await ctx.newPage();
  await page.goto(`${APP}/?persona=owner`);
  await page.waitForURL(/\/t\/[^/]+\//);
  const alta = /\/t\/([^/]+)/.exec(page.url())[1];
  await api(page, 'POST', '/api/v1/dev/scenario', { reset: true });
  const cases = [
    ['driver', '/'],
    ['foreman', '/'],
    ['owner', `/t/${alta}/repair`],
    ['owner', `/t/${alta}/fleet`],
    ['manager', `/t/${alta}/forms`],
  ];
  const run = async (label) => {
    await page.locator('.ox-gate').waitFor({ timeout: 15000 });
    await page.waitForLoadState('networkidle');
    const { violations } = await new AxeBuilder({ page }).analyze();
    const v = violations.map((x) => ({ id: x.id, impact: x.impact, nodes: x.nodes.map((n) => n.target.join(' ')) }));
    results.push({ width: w, case: label, violations: v });
    console.log(w, label, v.length ? JSON.stringify(v) : 'clean');
  };
  for (const [persona, route] of cases) {
    await page.goto(`${APP}${route}${route.includes('?') ? '&' : '?'}persona=${persona}`);
    await run(`${persona} ${route.replace(alta, ':t')}`);
  }
  // logist: fleet enabled → no role / review
  await page.goto(`${APP}/t/${alta}/modules?persona=owner`);
  await page.waitForLoadState('networkidle');
  await api(page, 'PUT', `/api/v1/tenants/${alta}/modules/fleet`, { enabled: true });
  for (const r of ['fleet', 'review']) {
    await page.goto(`${APP}/t/${alta}/${r}?persona=manager`);
    await run(`manager /t/:t/${r} (fleet on)`);
  }
  await page.goto(`${APP}/t/${alta}/modules?persona=owner`);
  await page.waitForLoadState('networkidle');
  await api(page, 'PUT', `/api/v1/tenants/${alta}/modules/fleet`, { enabled: false, retainedAccess: 'history_read' });
  await page.goto(`${APP}/t/${alta}/fleet?persona=manager`);
  await run('manager /t/:t/fleet (fleet ro)');
  await api(page, 'POST', '/api/v1/dev/scenario', { reset: true });
  await ctx.close();
}
await browser.close();
writeFileSync(join(EV, 'axe.json'), JSON.stringify(results, null, 2), 'utf8');
const bad = results.flatMap((r) => r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${r.width} ${r.case}: ${v.id}`));
console.log('serious/critical:', bad.length ? bad.join('; ') : 'none');
