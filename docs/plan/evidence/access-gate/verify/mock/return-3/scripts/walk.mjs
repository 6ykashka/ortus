// Verifier W1.20 return 3 — access-gate MCP walk (mock, app 6103).
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
const ev = async (fn) => result(await m.call('browser_evaluate', { function: fn }));
const gateText = () =>
  ev(`() => { const g = document.querySelector('.ox-gate'); const b = [...document.querySelectorAll('#ox-main [role=status],#ox-main [role=alert]')].map(x => x.getAttribute('role') + ':' + x.textContent.trim()).filter(Boolean);
      return JSON.stringify({ url: location.pathname, gate: g ? [...g.children].map(c => c.textContent.trim()) : null, reason: g?.dataset.reason ?? null, tone: g?.dataset.tone ?? null, h1: [...document.querySelectorAll('h1')].map(h => h.textContent), banners: b }); }`);
const api = (method, path, body) =>
  m.call('browser_evaluate', {
    function: `async () => { const h = {}; if (${JSON.stringify(method)} !== 'GET') { const c = /(?:^|;\\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1]; if (c) h['X-CSRF-Token'] = decodeURIComponent(c); h['Idempotency-Key'] = crypto.randomUUID(); }
      if (${JSON.stringify(method)} === 'PUT') { const g = await fetch(${JSON.stringify(path)}, { credentials: 'include' }); const e = g.headers.get('etag'); if (e) h['If-Match'] = e; }
      ${body ? "h['Content-Type'] = 'application/json';" : ''}
      const r = await fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, credentials: 'include', headers: h, body: ${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'} });
      return r.status + ' ' + (await r.text()).slice(0, 120); }`,
  });
const login = async (persona, route) => {
  await m.call('browser_navigate', { url: `${APP}${route}${route.includes('?') ? '&' : '?'}persona=${persona}` });
  await m.call('browser_wait_for', { time: 2 });
};
const styles = () =>
  ev(`() => { const g = document.querySelector('.ox-gate'); if (!g) return 'no gate';
      const cs = (e) => { if (!e) return null; const c = getComputedStyle(e); return { font: c.fontSize + '/' + c.lineHeight + ' ' + c.fontWeight, color: c.color, bg: c.backgroundColor, border: c.borderTop, radius: c.borderRadius, pad: c.padding, gap: c.gap, w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), maxW: c.maxWidth, tw: c.textWrapStyle || c.textWrap, ls: c.letterSpacing, ta: c.textAlign }; };
      return JSON.stringify({ card: cs(g), circle: cs(g.children[0]), icon: cs(g.children[0]?.firstElementChild), chip: cs(g.children[1]), h1: cs(g.querySelector('h1')), p: cs(g.querySelector('p')), btn: cs(g.querySelector('button')), iconText: g.children[0]?.textContent, iconHidden: g.children[0]?.firstElementChild?.getAttribute('aria-hidden'), docTitle: document.title }); }`);
const focusInfo = `() => { const e = document.activeElement; if (!e || e === document.body) return 'BODY'; const c = getComputedStyle(e); return e.tagName + '|' + (e.getAttribute('aria-label') || e.textContent.trim().slice(0, 40)) + '|outline=' + c.outlineStyle + ' ' + c.outlineWidth + ' ' + c.outlineColor + '|inGate=' + !!e.closest('.ox-gate'); }`;
const shot = (name) => m.call('browser_take_screenshot', { filename: join(OUT, name) });
const snap = async (name) => { const s = await m.call('browser_snapshot', {}); writeFileSync(join(EV, name), snapPart(s), 'utf8'); return s; };

let alta;
try {
  // 1. driver, three widths
  await m.call('browser_resize', { width: 1440, height: 900 });
  await login('driver', '/');
  note('driver 1440: ' + (await gateText()));
  let s = await snap('driver-1440.snapshot.yml');
  note('title: ' + (/Page Title: (.*)/.exec(s)?.[1] ?? '?'));
  note('styles 1440: ' + (await styles()));
  await shot('driver-1440.png');
  const tabs = [];
  for (let i = 0; i < 22; i++) { await m.call('browser_press_key', { key: 'Tab' }); tabs.push(await ev(focusInfo)); }
  note('driver Tab order 1440:\n  ' + tabs.join('\n  '));
  for (const [w, h] of [[768, 1024], [390, 844]]) {
    await m.call('browser_resize', { width: w, height: h });
    await m.call('browser_wait_for', { time: 1 });
    await snap(`driver-${w}.snapshot.yml`);
    await shot(`driver-${w}.png`);
    note(`styles ${w}: ` + (await styles()));
    note(`layout ${w}: ` + (await ev(`() => JSON.stringify({ scrollW: document.scrollingElement.scrollWidth, vw: innerWidth,
        navs: [...document.querySelectorAll('nav')].map(n => (n.getAttribute('aria-label') || '') + ':' + getComputedStyle(n).display + ':' + Math.round(n.getBoundingClientRect().width)),
        small: [...document.querySelectorAll('button, a, select')].filter(e => e.offsetParent && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 44).map(e => (e.getAttribute('aria-label') || e.textContent.trim()).slice(0,30) + ':' + Math.round(e.getBoundingClientRect().height)) })`)));
  }
  // 390: open from bottom nav by label «Автомобили» (cars)
  s = await m.call('browser_snapshot', {});
  try {
    await m.call('browser_click', { element: 'Автомобили', target: ref(s, 'button', 'Автомобили') });
    await m.call('browser_wait_for', { time: 1 });
    note('390 bottom nav «Автомобили»: ' + (await gateText()));
  } catch (e) { note('390 bottom nav «Автомобили» ERROR ' + e.message); }
  await m.call('browser_resize', { width: 1440, height: 900 });
  await m.call('browser_wait_for', { time: 1 });
  s = await m.call('browser_snapshot', {});
  try {
    await m.call('browser_click', { element: 'Сегодня', target: ref(s, 'button', 'Сегодня') });
    await m.call('browser_wait_for', { time: 1 });
    note('1440 menu «Сегодня»: ' + (await gateText()) + ' aria-current=' + (await ev(`() => [...document.querySelectorAll('[aria-current]')].map(e => e.textContent.trim() + '=' + e.getAttribute('aria-current')).join(',')`)));
  } catch (e) { note('1440 menu «Сегодня» ERROR ' + e.message); }

  // 2. foreman
  await login('foreman', '/');
  note('foreman: ' + (await gateText()));
  note('foreman styles: ' + (await styles()));
  await snap('foreman-1440.snapshot.yml');
  await shot('foreman-1440.png');

  // 3. owner /repair — keyboard to the action, Enter
  await login('owner', '/');
  alta = /\/t\/([^/]+)/.exec(await ev('() => location.pathname'))?.[1];
  note('alta = ' + alta);
  note('reset: ' + result(await api('POST', '/api/v1/dev/scenario', { reset: true })));
  await login('owner', `/t/${alta}/repair`);
  note('owner repair: ' + (await gateText()));
  note('owner repair styles: ' + (await styles()));
  await snap('owner-repair-1440.snapshot.yml');
  await shot('owner-repair-1440.png');
  const ot = [];
  for (let i = 0; i < 40; i++) { await m.call('browser_press_key', { key: 'Tab' }); const f = await ev(focusInfo); ot.push(f); if (f.includes('inGate=true')) break; }
  note('owner Tab to action (' + ot.length + ' steps), last: ' + ot.at(-1));
  await shot('owner-repair-focus-1440.png');
  await m.call('browser_press_key', { key: 'Enter' });
  await m.call('browser_wait_for', { time: 2 });
  note('owner after Enter: ' + (await gateText()));

  // 4. owner /fleet (branch B owner) — click by role
  await login('owner', `/t/${alta}/fleet`);
  note('owner fleet: ' + (await gateText()));
  s = await snap('owner-fleet-1440.snapshot.yml');
  await m.call('browser_click', { element: 'Открыть «Модули и место»', target: ref(s, 'button', 'Открыть «Модули и место»') });
  await m.call('browser_wait_for', { time: 2 });
  note('owner fleet click: ' + (await gateText()));

  // 5. logist
  await login('manager', `/t/${alta}/fleet`);
  note('manager fleet (off): ' + (await gateText()));
  await shot('manager-fleet-off-1440.png');
  await login('owner', `/t/${alta}/modules`);
  note('enable fleet: ' + result(await api('PUT', `/api/v1/tenants/${alta}/modules/fleet`, { enabled: true })));
  for (const r of ['fleet', 'review', 'pool', 'cars']) {
    await login('manager', `/t/${alta}/${r}`);
    note(`manager ${r} (fleet on): ` + (await gateText()));
    if (r === 'fleet') { await snap('manager-fleet-norole.snapshot.yml'); await shot('manager-fleet-norole-1440.png'); }
    if (r === 'review') await shot('manager-review-1440.png');
  }
  await login('manager', `/t/${alta}/forms`);
  note('manager forms: ' + (await gateText()));
  await shot('manager-forms-1440.png');
  await login('driver', '/');
  note('driver (fleet on): ' + (await gateText()));

  // 6. disabled with history
  await login('owner', `/t/${alta}/modules`);
  note('disable fleet: ' + result(await api('PUT', `/api/v1/tenants/${alta}/modules/fleet`, { enabled: false, retainedAccess: 'history_read' })));
  await login('driver', '/');
  note('driver (fleet ro): ' + (await gateText()));
  await shot('driver-readonly-1440.png');
  await login('manager', `/t/${alta}/fleet`);
  note('manager fleet (ro): ' + (await gateText()));
  await shot('manager-fleet-disabled-1440.png');
  await login('owner', `/t/${alta}/fleet`);
  note('owner fleet (ro): ' + (await gateText()));

  // 7. reset; tenant presets on a gate page
  note('reset: ' + result(await api('POST', '/api/v1/dev/scenario', { reset: true })));
  for (const preset of ['trial-ended', 'storage-full']) {
    note(`preset ${preset}: ` + result(await api('POST', '/api/v1/dev/scenario', { preset })));
    await login('driver', '/');
    note(`driver gate + ${preset}: ` + (await gateText()));
    await shot(`driver-${preset}-1440.png`);
    await login('owner', `/t/${alta}/repair`);
    note(`owner repair + ${preset}: ` + (await gateText()));
    note('reset: ' + result(await api('POST', '/api/v1/dev/scenario', { reset: true })));
  }

  // 8. offline on the gate page, Escape in popover
  await login('driver', '/');
  await m.call('browser_run_code_unsafe', { code: 'async (page) => { await page.context().setOffline(true); }' });
  await m.call('browser_wait_for', { time: 1 });
  note('driver offline: ' + (await gateText()));
  await shot('driver-offline-1440.png');
  await m.call('browser_run_code_unsafe', { code: 'async (page) => { await page.context().setOffline(false); }' });
  await m.call('browser_wait_for', { time: 1 });
  s = await m.call('browser_snapshot', {});
  await m.call('browser_click', { element: 'Профиль', target: ref(s, 'button', 'Профиль') });
  await m.call('browser_wait_for', { time: 1 });
  await m.call('browser_press_key', { key: 'Escape' });
  note('Escape in «Профиль» → focus: ' + (await ev(focusInfo)));

  // 9. loading and error
  note('delay: ' + result(await api('POST', '/api/v1/dev/scenario', { scenario: 'getMyContext=delay=4000' })));
  await m.call('browser_navigate', { url: `${APP}/t/${alta}/today` });
  note('loading t+0: ' + (await gateText()) + ' | ' + (await ev('() => document.body.innerText.slice(0, 200).replace(/\\n/g, " / ")')));
  await shot('driver-loading-1440.png');
  await m.call('browser_wait_for', { time: 5 });
  note('loaded: ' + (await gateText()));
  note('clear: ' + result(await api('POST', '/api/v1/dev/scenario', { scenario: null })));
  note('err: ' + result(await api('POST', '/api/v1/dev/scenario', { scenario: 'getMyContext=offline' })));
  await m.call('browser_navigate', { url: `${APP}/t/${alta}/today` });
  await m.call('browser_wait_for', { time: 3 });
  note('error: ' + (await gateText()) + ' | ' + (await ev('() => document.body.innerText.slice(0, 200).replace(/\\n/g, " / ")')));
  await shot('driver-error-1440.png');
  note('clear: ' + result(await api('POST', '/api/v1/dev/scenario', { scenario: null, reset: true })));

  // 10. therapist & operator (no gate expected)
  await login('therapist', '/');
  note('therapist: ' + (await gateText()));
  await login('operator', '/');
  note('operator: ' + (await gateText()));

  note('Console:\n' + (await m.call('browser_console_messages', { level: 'warning' })));
  note('Network (non-static):\n' + (await m.call('browser_network_requests', { static: false })));
} catch (e) {
  note('ERROR ' + e.stack);
} finally {
  writeFileSync(join(EV, 'walk.md'), out.join('\n\n'), 'utf8');
  m.save('walk.log.txt');
  m.close();
  process.exit(0);
}
