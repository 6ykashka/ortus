// Walk 2: foreman, owner (/repair action by keyboard, /fleet branch B), logist (fleet/review/forms),
// disabled with history, offline, loading.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { start, snapPart, ref } from './mcp.mjs';

const EV = process.env.EV;
const OUT = process.env.MCP_OUT;
const APP = 'http://127.0.0.1:6103';
const m = start();
await m.init();
const out = [];
const note = (s) => { out.push(s); console.log(s); };
const result = (t) => /### Result\n([^\n]*)/.exec(t)?.[1] ?? t.slice(0, 300);
const url = (t) => /Page URL: (\S+)/.exec(t)?.[1] ?? '?';
const gateText = async () =>
  result(await m.call('browser_evaluate', {
    function: `() => { const g = document.querySelector('.ox-gate'); const b = [...document.querySelectorAll('[role=status],[role=alert]')].map(x => x.textContent.trim()).filter(Boolean);
      return JSON.stringify({ url: location.pathname, gate: g ? [...g.children].map(c => c.textContent.trim()) : null, reason: g?.dataset.reason ?? null, h1: [...document.querySelectorAll('h1')].map(h => h.textContent), banners: b }); }`,
  }));
const api = (method, path, body) =>
  m.call('browser_evaluate', {
    function: `async () => { const h = {}; if (${JSON.stringify(method)} !== 'GET') { const c = /(?:^|;\\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1]; if (c) h['X-CSRF-Token'] = decodeURIComponent(c); h['Idempotency-Key'] = crypto.randomUUID(); }
      let etag; if (${JSON.stringify(method)} === 'PUT') { const g = await fetch(${JSON.stringify(path)}, { credentials: 'include' }); etag = g.headers.get('etag'); if (etag) h['If-Match'] = etag; }
      ${body ? "h['Content-Type'] = 'application/json';" : ''}
      const r = await fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, credentials: 'include', headers: h, body: ${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'} });
      return r.status + ' ' + (await r.text()).slice(0, 300); }`,
  });
let alta;
const login = async (persona, route) => {
  await m.call('browser_navigate', { url: `${APP}${route}${route.includes('?') ? '&' : '?'}persona=${persona}` });
  await m.call('browser_wait_for', { time: 2 });
};
try {
  await m.call('browser_resize', { width: 1440, height: 900 });

  // foreman
  await login('foreman', '/');
  note('foreman: ' + (await gateText()));
  await m.call('browser_take_screenshot', { filename: join(OUT, 'foreman-1440.png') });
  writeFileSync(join(EV, 'foreman-1440.snapshot.yml'), snapPart(await m.call('browser_snapshot', {})), 'utf8');

  // owner /repair, keyboard to the action
  await login('owner', '/');
  alta = /\/t\/([^/]+)/.exec(result(await m.call('browser_evaluate', { function: '() => location.pathname' })))?.[1];
  note('alta = ' + alta);
  await login('owner', `/t/${alta}/repair`);
  note('owner repair: ' + (await gateText()));
  let s = await m.call('browser_snapshot', {});
  writeFileSync(join(EV, 'owner-repair-1440.snapshot.yml'), snapPart(s), 'utf8');
  await m.call('browser_take_screenshot', { filename: join(OUT, 'owner-repair-1440.png') });
  const tabs = [];
  for (let i = 0; i < 30; i++) {
    await m.call('browser_press_key', { key: 'Tab' });
    const f = result(await m.call('browser_evaluate', {
      function: `() => { const e = document.activeElement; const c = getComputedStyle(e); return e.tagName + '|' + (e.getAttribute('aria-label') || e.textContent.trim().slice(0, 40)) + '|outline=' + c.outlineStyle + ' ' + c.outlineWidth + ' ' + c.outlineColor + '|inGate=' + !!e.closest('.ox-gate'); }`,
    }));
    tabs.push(f);
    if (f.includes('inGate=true')) break;
  }
  note('owner Tab order to gate action:\n  ' + tabs.join('\n  '));
  await m.call('browser_take_screenshot', { filename: join(OUT, 'owner-repair-focus-1440.png') });
  await m.call('browser_press_key', { key: 'Enter' });
  await m.call('browser_wait_for', { time: 2 });
  note('after Enter: ' + (await gateText()));

  // owner /fleet — branch B owner text + action
  await login('owner', `/t/${alta}/fleet`);
  note('owner fleet: ' + (await gateText()));
  await m.call('browser_take_screenshot', { filename: join(OUT, 'owner-fleet-1440.png') });
  s = await m.call('browser_snapshot', {});
  writeFileSync(join(EV, 'owner-fleet-1440.snapshot.yml'), snapPart(s), 'utf8');
  await m.call('browser_click', { element: 'Открыть «Модули и место»', target: ref(s, 'button', 'Открыть «Модули и место»') });
  await m.call('browser_wait_for', { time: 2 });
  note('owner fleet click: ' + (await gateText()));

  // logist without fleet module: /fleet
  await login('manager', `/t/${alta}/fleet`);
  note('manager fleet (module off): ' + (await gateText()));
  await m.call('browser_take_screenshot', { filename: join(OUT, 'manager-fleet-off-1440.png') });

  // enable fleet as owner
  await login('owner', `/t/${alta}/modules`);
  note('enable fleet: ' + result(await api('PUT', `/api/v1/tenants/${alta}/modules/fleet`, { enabled: true })));
  await login('manager', `/t/${alta}/fleet`);
  note('manager fleet (no role): ' + (await gateText()));
  s = await m.call('browser_snapshot', {});
  writeFileSync(join(EV, 'manager-fleet-norole.snapshot.yml'), snapPart(s), 'utf8');
  await m.call('browser_take_screenshot', { filename: join(OUT, 'manager-fleet-norole-1440.png') });
  await login('manager', `/t/${alta}/review`);
  note('manager review: ' + (await gateText()));
  await m.call('browser_take_screenshot', { filename: join(OUT, 'manager-review-1440.png') });
  await login('manager', `/t/${alta}/forms`);
  note('manager forms: ' + (await gateText()));
  await m.call('browser_take_screenshot', { filename: join(OUT, 'manager-forms-1440.png') });
  // driver with fleet on
  await login('driver', '/');
  note('driver (fleet on): ' + (await gateText()));

  // disable fleet with history
  await login('owner', `/t/${alta}/modules`);
  note('disable fleet: ' + result(await api('PUT', `/api/v1/tenants/${alta}/modules/fleet`, { enabled: false, retainedAccess: 'history_read' })));
  await login('driver', '/');
  note('driver (fleet ro): ' + (await gateText()));
  await m.call('browser_take_screenshot', { filename: join(OUT, 'driver-readonly-1440.png') });
  await login('manager', `/t/${alta}/fleet`);
  note('manager fleet (ro): ' + (await gateText()));
  await m.call('browser_take_screenshot', { filename: join(OUT, 'manager-fleet-disabled-1440.png') });
  await login('owner', `/t/${alta}/fleet`);
  note('owner fleet (ro): ' + (await gateText()));
  await m.call('browser_take_screenshot', { filename: join(OUT, 'owner-fleet-ro-1440.png') });

  // offline on a gate page (driver; module state reset by fresh scenario reset)
  await login('owner', '/');
  note('reset: ' + result(await api('POST', '/api/v1/dev/scenario', { reset: true })));
  await login('driver', '/');
  note('driver after reset: ' + (await gateText()));
  await m.call('browser_run_code_unsafe', { code: 'async (page) => { await page.context().setOffline(true); }' });
  await m.call('browser_wait_for', { time: 1 });
  note('driver offline: ' + (await gateText()));
  await m.call('browser_take_screenshot', { filename: join(OUT, 'driver-offline-1440.png') });
  await m.call('browser_run_code_unsafe', { code: 'async (page) => { await page.context().setOffline(false); }' });

  // loading: delay /me/context
  note('delay: ' + result(await api('POST', '/api/v1/dev/scenario', { scenario: 'getMyContext=delay=4000' })));
  await m.call('browser_navigate', { url: `${APP}/t/${alta}/today` });
  note('loading (t+0): ' + (await gateText()) + ' | ' + result(await m.call('browser_evaluate', { function: '() => document.body.innerText.slice(0, 120).replace(/\\n/g, " / ")' })));
  await m.call('browser_take_screenshot', { filename: join(OUT, 'driver-loading-1440.png') });
  await m.call('browser_wait_for', { time: 5 });
  note('loaded: ' + (await gateText()));
  note('clear: ' + result(await api('POST', '/api/v1/dev/scenario', { scenario: null })));

  // error: /me/context 500
  note('err: ' + result(await api('POST', '/api/v1/dev/scenario', { scenario: 'getMyContext=offline' })));
  await m.call('browser_navigate', { url: `${APP}/t/${alta}/today` });
  await m.call('browser_wait_for', { time: 3 });
  note('error: ' + (await gateText()) + ' | ' + result(await m.call('browser_evaluate', { function: '() => document.body.innerText.slice(0, 200).replace(/\\n/g, " / ")' })));
  await m.call('browser_take_screenshot', { filename: join(OUT, 'driver-error-1440.png') });
  note('clear: ' + result(await api('POST', '/api/v1/dev/scenario', { scenario: null, reset: true })));

  note('Console:\n' + (await m.call('browser_console_messages', { level: 'warning' })));
  note('Network (app):\n' + (await m.call('browser_network_requests', { static: false, filter: '127\\.0\\.0\\.1' })));
} catch (e) {
  note('ERROR ' + e.message);
} finally {
  writeFileSync(join(EV, 'walk2.md'), out.join('\n\n'), 'utf8');
  m.save('walk2.log.txt');
  m.close();
  process.exit(0);
}
